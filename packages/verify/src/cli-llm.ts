import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

// TODO(contract): relative imports into the api (see docs/contracts/requests/V09.md).
import { getEnv } from '../../../apps/api/src/env';
import { createGeminiProvider, extractReplyCall } from '../../../apps/api/src/llm/index';
import type { LlmProvider } from '../../../apps/api/src/llm/index';

import { configureLayerC, lastLayerCRun, runLayerC } from './layer-c.js';
import type { LayerCRealCase } from './layer-c.js';
import { runExtractionCheck } from './replies/index.js';
import type { ExtractionReport } from './replies/index.js';
import { renderReport, renderSummaryJson } from './report.js';
import type { LayerCConfig, LayerCSummary, NaiveInput, RunSummary } from './types.js';

/**
 * `npm run verify:llm` (V09): drives the layer-C runner and writes
 * VERIFICATION.md plus out/summary.json.
 *
 * Inputs it reads (all optional, all under `--out-dir`, default
 * `packages/verify/out`):
 * - `real-inputs.json`: the 38 real property submissions as rolled-up facts,
 *   `[{ caseId, input: NaiveInput }]`. Missing → 0 real cases, said loudly.
 * - `run-summary.json`: the layers A + B `RunSummary` from `npm run verify`.
 *   Missing → layers A and B are reported as 0 completed.
 *
 * Outputs: `layer-c.json`, `extraction.json`, `summary.json`, the disk cache
 * under `layer-c-cache/`, and `VERIFICATION.md` at the repository root.
 * Exit code 0 when every case was answered, 1 when some were not (rerun to
 * resume from the cache), 2 on a usage or configuration error.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const EXPECTED_REAL = 38;

interface CliOptions {
  readonly generated: number;
  readonly seed: number;
  readonly concurrency: number;
  readonly outDir: string;
  readonly cacheDir: string;
  readonly resume: boolean;
  readonly realPath: string;
  readonly runSummaryPath: string;
  readonly reportPath: string;
  readonly extraction: boolean;
}

export interface CliLlmDeps {
  /** Defaults to Gemini from `apps/api/src/env.ts`. */
  readonly llm?: LlmProvider;
  readonly log?: (line: string) => void;
  /** ISO timestamp source for the placeholder run summary. */
  readonly now?: () => string;
}

let deps: CliLlmDeps = {};

/** Test seam: inject a provider, a logger and a clock. */
export function setCliLlmDeps(next: CliLlmDeps): void {
  deps = next;
}

export async function main(argv: readonly string[]): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now ?? (() => new Date().toISOString());

  let opts: CliOptions;
  try {
    const parsed = parseArgs(argv);
    if (parsed === 'help') {
      log(USAGE);
      return 0;
    }
    opts = parsed;
  } catch (error) {
    log(`verify:llm: ${messageOf(error)}`);
    log(USAGE);
    return 2;
  }

  let llm: LlmProvider;
  try {
    llm = deps.llm ?? createGeminiProvider({ apiKey: getEnv().GEMINI_API_KEY });
  } catch (error) {
    log(`verify:llm: could not read configuration: ${messageOf(error)}`);
    return 2;
  }
  if (!llm.configured) {
    log('verify:llm: GEMINI_API_KEY is not set, so layer C cannot run. Set it in .env and rerun.');
    return 2;
  }

  let realCases: LayerCRealCase[];
  try {
    realCases = await readRealCases(opts.realPath);
  } catch (error) {
    log(`verify:llm: ${opts.realPath}: ${messageOf(error)}`);
    return 2;
  }
  if (realCases.length === 0) {
    log(`verify:llm: WARNING no real property submissions loaded (${opts.realPath} not found); judging generated cases only.`);
  } else if (realCases.length !== EXPECTED_REAL) {
    log(`verify:llm: WARNING ${realCases.length} real property submissions loaded, expected ${EXPECTED_REAL}.`);
  }

  let lastLogged = 0;
  configureLayerC({
    llm,
    realCases,
    onProgress: (p) => {
      if (p.done === p.total || p.done - lastLogged >= 50) {
        lastLogged = p.done;
        log(`layer C: ${p.done}/${p.total} judged (${p.cached} from cache, ${p.errors} unanswered)`);
      }
    },
  });

  const config: LayerCConfig = {
    generatedCount: opts.generated,
    seed: opts.seed,
    concurrency: opts.concurrency,
    cacheDir: opts.cacheDir,
    outDir: opts.outDir,
    resume: opts.resume,
  };
  log(
    `layer C: ${realCases.length} real + ${opts.generated} generated cases, seed ${opts.seed}, ` +
      `concurrency ${opts.concurrency}, ${opts.resume ? 'resuming from' : 'ignoring'} cache ${opts.cacheDir}`,
  );
  const summary = await runLayerC(config);
  const detail = lastLayerCRun();
  const errors = detail?.errors ?? [];

  let extraction: ExtractionReport | null = null;
  if (opts.extraction) {
    log('extraction check: running the extract-reply call over the broker-reply fixtures');
    extraction = await runExtractionCheck((input) => extractReplyCall(llm, input));
    await writeJsonAtomic(join(opts.outDir, 'extraction.json'), extraction);
  }

  const run = await readRunSummary(opts.runSummaryPath, now(), log);
  const summaryJson: Record<string, unknown> = {
    ...renderSummaryJson(run, summary),
    extractionFieldAccuracy: extraction ? extraction.score.fieldAccuracy : null,
    layerCUnanswered: errors.length,
    layerCRealCases: detail?.realCases ?? 0,
    extraction: extraction ? { score: extraction.score, byStyle: extraction.byStyle, errors: extraction.errors } : null,
  };
  await writeJsonAtomic(join(opts.outDir, 'summary.json'), summaryJson);

  const report = [
    renderReport(run, summary).trimEnd(),
    '',
    ...layerCNotes(summary, detail?.realCases ?? 0, detail?.decidingFactorAgreed ?? 0, errors.length),
    ...extractionSection(extraction),
  ].join('\n');
  await mkdir(dirname(opts.reportPath), { recursive: true });
  await writeFile(opts.reportPath, `${report}\n`, 'utf8');

  const rate = summary.total > 0 ? `${(summary.agreement.point * 100).toFixed(1)}%` : 'n/a';
  log(
    `layer C: ${summary.agreed}/${summary.total} agreed (${rate}, 95% CI ` +
      `${(summary.agreement.low * 100).toFixed(1)}–${(summary.agreement.high * 100).toFixed(1)}%), ` +
      `${summary.disagreements.length} disagreements, ${errors.length} unanswered`,
  );
  log(`wrote ${opts.reportPath} and ${join(opts.outDir, 'summary.json')}`);
  if (errors.length > 0) {
    log(`verify:llm: ${errors.length} cases unanswered; rerun to resume from the cache.`);
    for (const e of errors.slice(0, 10)) log(`  ${e.caseId}: ${e.message}`);
    return 1;
  }
  return 0;
}

/* ------------------------------------------------------------ private */

const USAGE = [
  'Usage: npm run verify:llm -- [options]',
  '  --generated <n>     generated stratified cases (default 2000)',
  '  --seed <n>          generator seed (default 1)',
  '  --concurrency <n>   parallel model calls (default 2)',
  '  --out-dir <dir>     outputs and inputs (default packages/verify/out)',
  '  --cache-dir <dir>   judgement cache (default <out-dir>/layer-c-cache)',
  '  --no-resume         ignore cached judgements (they are still rewritten)',
  '  --real <file>       real submissions JSON (default <out-dir>/real-inputs.json)',
  '  --run-summary <f>   layers A+B RunSummary JSON (default <out-dir>/run-summary.json)',
  '  --report <file>     report path (default VERIFICATION.md at the repo root)',
  '  --no-extraction     skip the broker-reply extraction check',
].join('\n');

function parseArgs(argv: readonly string[]): CliOptions | 'help' {
  let generated = 2000;
  let seed = 1;
  let concurrency = 2;
  let outDir: string | null = null;
  let cacheDir: string | null = null;
  let resume = true;
  let realPath: string | null = null;
  let runSummaryPath: string | null = null;
  let reportPath: string | null = null;
  let extraction = true;

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]!;
    const eq = raw.indexOf('=');
    const flag = raw.startsWith('--') && eq > 0 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith('--') && eq > 0 ? raw.slice(eq + 1) : null;
    const value = (): string => {
      if (inline !== null) return inline;
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      i += 1;
      return v;
    };
    switch (flag) {
      case '--help':
      case '-h':
        return 'help';
      case '--generated':
        generated = nonNegativeInt(flag, value());
        break;
      case '--seed':
        seed = nonNegativeInt(flag, value());
        break;
      case '--concurrency':
        concurrency = nonNegativeInt(flag, value());
        if (concurrency < 1) throw new Error('--concurrency must be at least 1');
        break;
      case '--out-dir':
        outDir = value();
        break;
      case '--cache-dir':
        cacheDir = value();
        break;
      case '--no-resume':
        resume = false;
        break;
      case '--resume':
        resume = true;
        break;
      case '--real':
        realPath = value();
        break;
      case '--run-summary':
        runSummaryPath = value();
        break;
      case '--report':
        reportPath = value();
        break;
      case '--no-extraction':
        extraction = false;
        break;
      default:
        throw new Error(`unknown argument ${raw}`);
    }
  }

  const out = abs(outDir ?? join('packages', 'verify', 'out'));
  return {
    generated,
    seed,
    concurrency,
    outDir: out,
    cacheDir: cacheDir === null ? join(out, 'layer-c-cache') : abs(cacheDir),
    resume,
    realPath: realPath === null ? join(out, 'real-inputs.json') : abs(realPath),
    runSummaryPath: runSummaryPath === null ? join(out, 'run-summary.json') : abs(runSummaryPath),
    reportPath: reportPath === null ? join(REPO_ROOT, 'VERIFICATION.md') : abs(reportPath),
    extraction,
  };
}

/** Relative paths are taken from the repository root, where npm runs the script. */
function abs(p: string): string {
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}

function nonNegativeInt(flag: string, v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} must be a non-negative integer, got ${v}`);
  return n;
}

const nullableNumber = z.number().nullable();

const NAIVE_INPUT = z.object({
  submissionType: z.string().nullable(),
  lineOfBusiness: z.string().nullable(),
  primaryState: z.string().nullable(),
  totalTiv: nullableNumber,
  quotedPremium: nullableNumber,
  pctTivPre1990: nullableNumber,
  pctTivPost2010: nullableNumber,
  pctTivAcceptableConstruction: nullableNumber,
  fiveYearLoss: nullableNumber,
  anyBuildingPre1990: z.boolean().nullable(),
  hasOpenHighContradiction: z.boolean(),
});

const REAL_FILE = z.array(z.object({ caseId: z.string().min(1), input: NAIVE_INPUT }));

async function readRealCases(path: string): Promise<LayerCRealCase[]> {
  if (!existsSync(path)) return [];
  const parsed = REAL_FILE.safeParse(JSON.parse(await readFile(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `not a [{ caseId, input: NaiveInput }] array: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data.map((r) => ({ caseId: r.caseId, input: r.input satisfies NaiveInput }));
}

const RUN_SUMMARY = z.looseObject({
  startedAt: z.string(),
  finishedAt: z.string(),
  config: z.looseObject({
    total: z.number(),
    seed: z.number(),
    workers: z.number(),
    chunkSize: z.number(),
    maxDisagreements: z.number(),
    outDir: z.string(),
  }),
  completed: z.number(),
  invariantViolations: z.number(),
  disagreements: z.number(),
  errors: z.number(),
  casesPerSecond: z.number(),
  firstViolations: z.array(z.unknown()),
  firstDisagreements: z.array(z.unknown()),
});

async function readRunSummary(path: string, nowIso: string, log: (line: string) => void): Promise<RunSummary> {
  if (existsSync(path)) {
    try {
      const parsed = RUN_SUMMARY.safeParse(JSON.parse(await readFile(path, 'utf8')));
      if (parsed.success) return parsed.data as unknown as RunSummary;
      log(`verify:llm: WARNING ${path} is not a RunSummary; layers A and B reported as not run.`);
    } catch (error) {
      log(`verify:llm: WARNING could not read ${path}: ${messageOf(error)}`);
    }
  } else {
    log(`verify:llm: WARNING ${path} not found; run \`npm run verify\` first. Layers A and B reported as 0.`);
  }
  return {
    startedAt: nowIso,
    finishedAt: nowIso,
    config: { total: 0, seed: 0, workers: 0, chunkSize: 0, maxDisagreements: 0, outDir: '' },
    completed: 0,
    invariantViolations: 0,
    disagreements: 0,
    errors: 0,
    casesPerSecond: 0,
    firstViolations: [],
    firstDisagreements: [],
  };
}

function layerCNotes(
  summary: LayerCSummary,
  realCases: number,
  factorAgreed: number,
  unanswered: number,
): string[] {
  const out = ['## Layer C: run notes', ''];
  out.push(
    `- Real property submissions in the run: ${realCases} (of ${EXPECTED_REAL} in the book).`,
  );
  out.push(
    '- Agreement means the model reached the same verdict. The deciding factor is compared separately: ' +
      `${factorAgreed} of ${summary.agreed} agreeing cases also named the same deciding factor.`,
  );
  out.push(
    `- Cases the model did not answer (excluded from every count above): ${unanswered}.` +
      (unanswered > 0 ? ' Rerun `npm run verify:llm` to resume from the cache.' : ''),
  );
  out.push('');
  return out;
}

function extractionSection(report: ExtractionReport | null): string[] {
  const out = ['## Extraction check', ''];
  if (report === null) {
    out.push('Not run in this pass (`--no-extraction`).', '');
    return out;
  }
  const s = report.score;
  out.push(
    `- Broker replies: ${s.fixtures}. Fields expected: ${s.fieldsExpected}, extracted correctly: ${s.fieldsCorrect} ` +
      `(${(s.fieldAccuracy * 100).toFixed(1)}%).`,
  );
  out.push(`- Wrong values that still cleared the 0.8 confidence gate: ${s.wrongThroughGate}.`);
  out.push(`- Replies whose extraction call failed: ${report.errors.length}.`, '');
  out.push('| Style | Fields | Correct | Wrong through gate |', '| --- | --- | --- | --- |');
  for (const row of report.byStyle) {
    out.push(`| ${row.style} | ${row.fieldsExpected} | ${row.fieldsCorrect} | ${row.wrongThroughGate} |`);
  }
  out.push('');
  return out;
}

let tmpCounter = 0;

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  tmpCounter += 1;
  const tmp = `${path}.${process.pid}.${tmpCounter}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run only when executed directly (`npm run verify:llm`), never on import. */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
