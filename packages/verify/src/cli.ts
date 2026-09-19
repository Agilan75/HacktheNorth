import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { requestStop, runPool } from './pool.js';
import { renderReport, renderSummaryJson } from './report.js';
import type { ChunkResult, RunConfig, RunSummary } from './types.js';

/**
 * `npm run verify` (V08): the 10M layers A + B run. Prints throughput, the
 * count actually completed, and every violation or disagreement it kept.
 *
 * Flags (all optional): `--total N` (10,000,000), `--seed N` (20260919),
 * `--workers N` (min(6, cores − 1)), `--chunk N` (10,000),
 * `--max-disagreements N` (0 = never stop), `--out DIR` (packages/verify/out).
 * Underscores in numbers are allowed (`--total 100_000`).
 *
 * Writes `<out>/run.json` (the raw RunSummary), `<out>/summary.json` (what the
 * API's /aggregate route reads; layer-C keys already there are preserved) and
 * `<out>/layers-ab.md` (the report with layer C marked not run).
 *
 * Exit code: 0 only when every requested case completed with zero invariant
 * violations, zero disagreements and zero errors; 1 otherwise; 2 on bad flags;
 * 130 when interrupted (the partial count is still written).
 */

const DEFAULTS = {
  total: 10_000_000,
  seed: 20260919,
  chunkSize: 10_000,
  maxDisagreements: 0,
} as const;

const DEFAULT_OUT = fileURLToPath(new URL('../out', import.meta.url));

/** Keys of summary.json owned by layer C / the extraction check (V09), kept across A+B runs. */
const PRESERVED_KEYS = ['llmCasesRun', 'llmAgreementRate', 'llmAgreementCi95', 'extractionFieldAccuracy', 'layerC'] as const;

function defaultWorkers(): number {
  return Math.max(1, Math.min(6, availableParallelism() - 1));
}

type ParsedArgs = { readonly config: RunConfig } | { readonly error: string };

function parseCount(flag: string, raw: string | undefined, min: number): number | string {
  if (raw === undefined) return `${flag} needs a value`;
  const n = Number(raw.replace(/_/g, ''));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) return `${flag} must be an integer >= ${min}, got "${raw}"`;
  return n;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let total: number = DEFAULTS.total;
  let seed: number = DEFAULTS.seed;
  let workers = defaultWorkers();
  let chunkSize: number = DEFAULTS.chunkSize;
  let maxDisagreements: number = DEFAULTS.maxDisagreements;
  let outDir = DEFAULT_OUT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const eq = arg.indexOf('=');
    const flag = eq >= 0 ? arg.slice(0, eq) : arg;
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    let parsed: number | string;
    switch (flag) {
      case '--total':
        parsed = parseCount(flag, value, 0);
        if (typeof parsed === 'string') return { error: parsed };
        total = parsed;
        break;
      case '--seed':
        parsed = parseCount(flag, value, 0);
        if (typeof parsed === 'string') return { error: parsed };
        seed = parsed;
        break;
      case '--workers':
        parsed = parseCount(flag, value, 1);
        if (typeof parsed === 'string') return { error: parsed };
        workers = parsed;
        break;
      case '--chunk':
        parsed = parseCount(flag, value, 1);
        if (typeof parsed === 'string') return { error: parsed };
        chunkSize = parsed;
        break;
      case '--max-disagreements':
        parsed = parseCount(flag, value, 0);
        if (typeof parsed === 'string') return { error: parsed };
        maxDisagreements = parsed;
        break;
      case '--out':
        if (value === undefined || value === '') return { error: '--out needs a directory' };
        outDir = resolve(value);
        break;
      default:
        return { error: `unknown flag "${arg}"` };
    }
  }
  return { config: { total, seed, workers, chunkSize, maxDisagreements, outDir } };
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Writes run.json, summary.json and layers-ab.md; returns the paths written. */
export function writeOutputs(run: RunSummary): readonly string[] {
  const dir = run.config.outDir;
  mkdirSync(dir, { recursive: true });
  const runPath = join(dir, 'run.json');
  const summaryPath = join(dir, 'summary.json');
  const reportPath = join(dir, 'layers-ab.md');

  const summary: Record<string, unknown> = { ...renderSummaryJson(run, null) };
  const previous = readJsonObject(summaryPath);
  if (previous !== null) {
    for (const key of PRESERVED_KEYS) if (key in previous) summary[key] = previous[key];
  }

  writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(reportPath, renderReport(run, null));
  return [runPath, summaryPath, reportPath];
}

function int(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function printSummary(run: RunSummary, log: (line: string) => void): void {
  const c = run.config;
  log('');
  log(`Layers A + B — seed ${c.seed}, ${c.workers} workers, chunk ${int(c.chunkSize)}`);
  log(`  completed            ${int(run.completed)} of ${int(c.total)} requested`);
  log(`  throughput           ${int(run.casesPerSecond)} cases/s`);
  log(`  invariant violations ${int(run.invariantViolations)}`);
  log(`  disagreements        ${int(run.disagreements)}`);
  log(`  errors               ${int(run.errors)}`);
  for (const v of run.firstViolations) {
    log(`  VIOLATION ${v.invariant} ${v.caseId}: ${v.message} (observed ${JSON.stringify(v.observed)}, expected ${JSON.stringify(v.expected)})`);
  }
  for (const d of run.firstDisagreements) {
    const fields = d.fields.map((f) => `${f.field} engine=${JSON.stringify(f.engine)} naive=${JSON.stringify(f.naive)}`).join('; ');
    log(`  DISAGREE ${d.caseId}: ${fields}`);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`verify: ${parsed.error}\n`);
    return 2;
  }
  const { config } = parsed;
  const log = (line: string): void => void process.stdout.write(`${line}\n`);

  let interrupted = false;
  const onSignal = (): void => {
    interrupted = true;
    process.stderr.write('\nverify: stopping — finishing the cases in flight, the partial count will be written\n');
    requestStop();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const t0 = performance.now();
  let done = 0;
  let lastPrint = 0;
  const onChunk = (result: ChunkResult): void => {
    done += result.completed;
    const now = performance.now();
    if (now - lastPrint < 1000 && done < config.total) return;
    lastPrint = now;
    const rate = (done * 1000) / Math.max(1, now - t0);
    process.stderr.write(`\r  ${int(done)} / ${int(config.total)}  ${int(rate)} cases/s   `);
  };

  log(`verify: ${int(config.total)} cases, seed ${config.seed}, ${config.workers} workers, chunk ${int(config.chunkSize)}`);
  let run: RunSummary;
  try {
    run = await runPool(config, onChunk);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  process.stderr.write('\n');

  printSummary(run, log);
  for (const path of writeOutputs(run)) log(`  wrote ${path}`);

  if (interrupted) return 130;
  const clean =
    run.completed === config.total && run.invariantViolations === 0 && run.disagreements === 0 && run.errors === 0;
  return clean ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`verify: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      process.exitCode = 1;
    },
  );
}
