/**
 * The verification results, read from the committed files the verify package
 * wrote, for `GET /verification` and for the per-account block on
 * `GET /submissions/:id` (FILL-backend D5-D7).
 *
 * The API cannot import `@retrofit/verify` -- verify depends on api, so that
 * would be a cycle -- so it reads the verify package's OUTPUT files at runtime,
 * the way `aggregate.ts` already reads summary.json. Every number served here
 * is parsed from one of those files; nothing is restated in code. A file that
 * is absent yields a null block (shown as absent), never a filled-in one.
 */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type {
  AccountVerificationDto,
  LayerCDisagreementDto,
  VerificationDefectDto,
  VerificationDto,
} from '@retrofit/contracts';
import type { EngineResult } from '@retrofit/engine';

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

/** Repo root, from `apps/api/{src,dist}/services/` (the same depth aggregate.ts uses). */
const ROOT = new URL('../../../../', import.meta.url);
const at = (rel: string): string => fileURLToPath(new URL(rel, ROOT));

/** Repo-relative path of every file read, in the order they are listed in `sources`. */
export const SOURCE_PATHS = {
  run: 'packages/verify/out/run.json',
  summary: 'packages/verify/out/summary.json',
  layerC: 'packages/verify/out/layer-c.json',
  perAccount: 'packages/verify/out/per-account.json',
  verificationMd: 'VERIFICATION.md',
  decisionsMd: 'DECISIONS.md',
} as const;

export type SourceKey = keyof typeof SOURCE_PATHS;

/** The file contents a verification view is built from; null = the file is absent. */
export type SourceTexts = Readonly<Record<SourceKey, string | null>>;

function isMissingFile(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Re-read only when the file changed on disk (a re-run of a verify script). */
const cache = new Map<string, { readonly mtimeMs: number; readonly text: string | null }>();

function readText(path: string): string | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
  const hit = cache.get(path);
  if (hit !== undefined && hit.mtimeMs === mtimeMs) return hit.text;
  const text = readFileSync(path, 'utf8');
  cache.set(path, { mtimeMs, text });
  return text;
}

export function readSources(paths: Readonly<Record<SourceKey, string>> = defaultPaths()): SourceTexts {
  return {
    run: readText(paths.run),
    summary: readText(paths.summary),
    layerC: readText(paths.layerC),
    perAccount: readText(paths.perAccount),
    verificationMd: readText(paths.verificationMd),
    decisionsMd: readText(paths.decisionsMd),
  };
}

export function defaultPaths(): Readonly<Record<SourceKey, string>> {
  return {
    run: at(SOURCE_PATHS.run),
    summary: at(SOURCE_PATHS.summary),
    layerC: at(SOURCE_PATHS.layerC),
    perAccount: at(SOURCE_PATHS.perAccount),
    verificationMd: at(SOURCE_PATHS.verificationMd),
    decisionsMd: at(SOURCE_PATHS.decisionsMd),
  };
}

function parseJson<T>(text: string | null, schema: z.ZodType<T>, what: string): T | null {
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`verification: ${what} is not valid JSON: ${String(err)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `verification: ${what} does not have the expected shape: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

/* -------------------------------------------------------------------------- */
/* File schemas (only the keys read)                                          */
/* -------------------------------------------------------------------------- */

const verdict = z.enum(['FIT', 'REFER', 'DOES_NOT_FIT']);

const outcome = z.object({
  verdict,
  appetiteScore: z.number(),
  knockoutFactorIds: z.array(z.string()),
  decidingFactorId: z.string().nullable(),
});

const perAccountFileSchema = z.object({
  generatedAt: z.string(),
  summary: z.object({
    total: z.number().int(),
    naiveAgreedAll: z.number().int(),
    secondOpinionAnswered: z.number().int(),
    secondOpinionAgreed: z.number().int(),
  }),
  accounts: z.record(
    z.string(),
    z.object({
      caseId: z.string(),
      engine: outcome,
      naive: outcome.extend({
        agrees: z.object({
          verdict: z.boolean(),
          appetiteScore: z.boolean(),
          knockouts: z.boolean(),
          decidingFactor: z.boolean(),
          all: z.boolean(),
        }),
      }),
      secondOpinion: z
        .object({
          verdict,
          decidingFactor: z.string(),
          reasoning: z.string(),
          agreed: z.boolean(),
          decidingFactorAgreed: z.boolean(),
          engine: outcome,
        })
        .nullable(),
    }),
  ),
});

export type PerAccountFile = z.infer<typeof perAccountFileSchema>;

const runSchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  config: z.object({ total: z.number().int(), seed: z.number().int(), workers: z.number().int() }),
  completed: z.number().int(),
  invariantViolations: z.number().int(),
  disagreements: z.number().int(),
  errors: z.number().int(),
  casesPerSecond: z.number(),
});

const layerCEngine = outcome.extend({
  completeness: z.number(),
  tierValuesByFactor: z.record(z.string(), z.number().nullable()),
});

const layerCCase = z.object({
  caseId: z.string(),
  stratum: z.string(),
  engine: layerCEngine,
  model: z.object({ verdict, decidingFactor: z.string(), reasoning: z.string() }),
  agreed: z.boolean(),
});

const layerCFileSchema = z.object({
  summary: z.object({
    total: z.number().int(),
    agreed: z.number().int(),
    agreement: z.object({
      point: z.number(),
      low: z.number(),
      high: z.number(),
      n: z.number().int(),
      confidence: z.number(),
    }),
    byStratum: z.array(z.object({ stratum: z.string(), total: z.number().int(), agreed: z.number().int() })),
    disagreements: z.array(layerCCase),
  }),
  decidingFactorAgreed: z.number().int(),
  errors: z.array(z.unknown()),
});

const summarySchema = z.object({
  extractionFieldAccuracy: z.number().nullable().optional(),
});

/* -------------------------------------------------------------------------- */
/* Per account                                                                */
/* -------------------------------------------------------------------------- */

export function parsePerAccount(text: string | null): PerAccountFile | null {
  return parseJson(text, perAccountFileSchema, SOURCE_PATHS.perAccount);
}

/** INTERPRETATIONS §7 SCORE_TOLERANCE. */
const SCORE_TOLERANCE = 1e-6;

/**
 * The verification record of one account, or null when the verification did
 * not cover it (a knockout, a sweep) or no per-account file exists.
 */
export function accountVerification(
  file: PerAccountFile | null,
  externalId: string,
  current: EngineResult,
): AccountVerificationDto | null {
  const rec = file?.accounts[externalId];
  if (file === null || rec === undefined) return null;
  return {
    caseId: rec.caseId,
    generatedAt: file.generatedAt,
    engine: rec.engine,
    matchesCurrentResult:
      current.verdict.verdict === rec.engine.verdict &&
      Math.abs(current.evaluate.appetiteScore - rec.engine.appetiteScore) <= SCORE_TOLERANCE,
    naive: rec.naive,
    secondOpinion: rec.secondOpinion,
  };
}

/** The per-account file as it stands on disk now, or null when absent. */
export function currentPerAccount(path: string = defaultPaths().perAccount): PerAccountFile | null {
  return parsePerAccount(readText(path));
}

/* -------------------------------------------------------------------------- */
/* Markdown                                                                   */
/* -------------------------------------------------------------------------- */

const toInt = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isInteger(n) ? n : null;
};

const stripBold = (s: string): string => s.replace(/\*\*/g, '').trim();

/** The body of `## <title>` up to the next `## ` heading, or null. */
function section(markdown: string, title: string): string | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

function sentences(paragraph: string): string[] {
  return paragraph
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z*`"(])/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Why the extraction check is not measured, from VERIFICATION.md's
 * "Extraction check" section: its opening sentences up to (never including)
 * the first one that carries a score, plus the line saying how to measure it.
 * The discarded score is never served (DECISIONS CP2-3, CP3-3).
 */
export function extractionReason(verificationMd: string | null): string | null {
  if (verificationMd === null) return null;
  const body = section(verificationMd, 'Extraction check');
  if (body === null) return null;
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== '');
  const first = paragraphs[0];
  if (first === undefined) return null;
  const kept: string[] = [];
  for (const s of sentences(stripBold(first))) {
    if (/\d%|\b\d+ of \d+\b/.test(s)) break;
    if (/^not measured\.?$/i.test(s)) continue;
    kept.push(s);
  }
  const how = paragraphs.find((p) => /^To measure it/i.test(p));
  if (how !== undefined && !/\d%/.test(how)) kept.push(stripBold(how));
  return kept.length === 0 ? null : kept.join(' ');
}

/** The DECISIONS.md rows that record a defect the testing found, in the order shown. */
const DEFECT_ROWS: readonly { readonly id: string; readonly phase: string }[] = [
  { id: 'CP1-2', phase: 'CP1' },
  { id: 'CP1-4', phase: 'CP1' },
  { id: 'CP1-5', phase: 'CP1' },
  { id: 'R2-3', phase: 'Run 2' },
  { id: 'R2-4', phase: 'Run 2' },
  { id: 'R2-2', phase: 'Run 2' },
  { id: 'R2-1', phase: 'Run 2' },
  { id: 'R2-5', phase: 'Run 2' },
  { id: 'R2-6', phase: 'Run 2' },
  { id: 'R2-7', phase: 'Run 2' },
  { id: 'R2-8', phase: 'Run 2' },
];

/** One `| id | **decision** | why | rejected |` row; the title is the decision's bold lead. */
function decisionRow(decisionsMd: string, id: string): { title: string; detail: string } | null {
  const line = decisionsMd.split('\n').find((l) => l.startsWith(`| ${id} |`));
  if (line === undefined) return null;
  const cells = line.split('|').map((c) => c.trim());
  // ['', id, decision, why, rejected, '']
  const decision = cells[2] ?? '';
  const why = cells[3] ?? '';
  const bold = /\*\*(.+?)\*\*/.exec(decision);
  const title = stripBold(bold?.[1] ?? decision);
  const detail = stripBold(why);
  if (title === '' || detail === '') return null;
  return { title, detail };
}

export function parseDefects(
  decisionsMd: string | null,
  verificationMd: string | null,
): VerificationDto['defectsFound'] {
  let cp1Violations: number | null = null;
  let cp1Disagreements: number | null = null;
  const cp1 =
    (verificationMd === null
      ? null
      : /\*\*([\d,]+) invariant violations and ([\d,]+) engine-vs-naive disagreements\*\*/.exec(verificationMd)) ??
    (decisionsMd === null ? null : /\(from ([\d,]+) and ([\d,]+)\)/.exec(decisionsMd));
  if (cp1 !== null) {
    cp1Violations = toInt(cp1[1]);
    cp1Disagreements = toInt(cp1[2]);
  }
  const run2 = decisionsMd === null ? null : /\*\*(\d+) findings were\s+confirmed, (\d+) refuted\.?\*\*/.exec(decisionsMd);
  const defects: VerificationDefectDto[] = [];
  if (decisionsMd !== null) {
    for (const row of DEFECT_ROWS) {
      const parsed = decisionRow(decisionsMd, row.id);
      if (parsed !== null) defects.push({ id: row.id, phase: row.phase, ...parsed });
    }
  }
  return {
    cp1InvariantViolations: cp1Violations,
    cp1Disagreements,
    run2Confirmed: toInt(run2?.[1]),
    run2Refuted: toInt(run2?.[2]),
    defects,
  };
}

/* -------------------------------------------------------------------------- */
/* The whole view                                                             */
/* -------------------------------------------------------------------------- */

export function buildVerification(texts: SourceTexts): VerificationDto {
  const run = parseJson(texts.run, runSchema, SOURCE_PATHS.run);
  const layerC = parseJson(texts.layerC, layerCFileSchema, SOURCE_PATHS.layerC);
  const summary = parseJson(texts.summary, summarySchema, SOURCE_PATHS.summary);
  const perAccount = parsePerAccount(texts.perAccount);

  const accuracy = summary?.extractionFieldAccuracy ?? null;
  const disagreements: LayerCDisagreementDto[] = (layerC?.summary.disagreements ?? []).map((d) => ({
    caseId: d.caseId,
    stratum: d.stratum,
    engine: {
      verdict: d.engine.verdict,
      appetiteScore: d.engine.appetiteScore,
      completeness: d.engine.completeness,
      knockoutFactorIds: d.engine.knockoutFactorIds,
      decidingFactorId: d.engine.decidingFactorId,
      tierValuesByFactor: d.engine.tierValuesByFactor,
    },
    model: d.model,
  }));

  const sources = (Object.keys(SOURCE_PATHS) as SourceKey[])
    .filter((k) => texts[k] !== null)
    .map((k) => SOURCE_PATHS[k]);

  return {
    layersAB:
      run === null
        ? null
        : {
            requested: run.config.total,
            completed: run.completed,
            seed: run.config.seed,
            workers: run.config.workers,
            invariantViolations: run.invariantViolations,
            disagreements: run.disagreements,
            errors: run.errors,
            casesPerSecond: run.casesPerSecond,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
          },
    layerC:
      layerC === null
        ? null
        : {
            judged: layerC.summary.total,
            agreed: layerC.summary.agreed,
            unanswered: layerC.errors.length,
            agreement: layerC.summary.agreement,
            decidingFactorAgreed: layerC.decidingFactorAgreed,
            byStratum: layerC.summary.byStratum.map((s) => ({
              ...s,
              rate: s.total > 0 ? s.agreed / s.total : null,
            })),
            disagreements,
          },
    realAccounts:
      perAccount === null ? null : { ...perAccount.summary, generatedAt: perAccount.generatedAt },
    extraction:
      accuracy === null
        ? { status: 'not_measured', fieldAccuracy: null, reason: extractionReason(texts.verificationMd) }
        : { status: 'measured', fieldAccuracy: accuracy, reason: null },
    defectsFound: parseDefects(texts.decisionsMd, texts.verificationMd),
    sources,
  };
}

/** `GET /verification`: the committed files as they stand on disk now. */
export function verification(paths?: Readonly<Record<SourceKey, string>>): VerificationDto {
  return buildVerification(readSources(paths));
}
