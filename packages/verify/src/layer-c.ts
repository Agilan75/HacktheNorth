import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// TODO(contract): `@retrofit/api`'s barrel (apps/api/src/index.ts) does not
// re-export the LLM layer, and its `exports` map exposes only ".", so this is a
// relative import into the api's own LLM barrel. See docs/contracts/requests/V09.md.
import { secondOpinionCall } from '../../../apps/api/src/llm/index';
import type { LlmProvider } from '../../../apps/api/src/llm/index';

import { engineViewForInput } from './compare.js';
import { factsForCase, guidelineBrief } from './facts.js';
import { stratifiedSample, strata } from './gen/stratify.js';
import type {
  EngineResultView,
  GeneratedCase,
  LayerCCaseResult,
  LayerCConfig,
  LayerCJudgement,
  LayerCSummary,
  NaiveInput,
  NaiveVerdict,
} from './types.js';
import { wilsonInterval } from './wilson.js';

/**
 * Layer-C runner (V09), PRD §12: all 38 real property submissions plus ~2,000
 * stratified generated cases. Disk cache keyed by case id so a run resumes,
 * concurrency 2 so the Gemini quota survives.
 *
 * The frozen signatures carry no provider and no real cases, so both are set
 * once with `configureLayerC` (the CLI does it; tests pass the fake provider).
 * A case the model could not answer is recorded as an error, left out of the
 * agreement count and never cached, so the next resumed run retries it.
 * See docs/decisions/V09.md.
 */

/** The stratum every real property submission is reported under. */
export const REAL_STRATUM = 'real_property';

/** Bumped when the cache entry shape changes; older entries are ignored. */
const CACHE_VERSION = 1;

export interface LayerCRealCase {
  readonly caseId: string;
  readonly input: NaiveInput;
}

export interface LayerCCaseError {
  readonly caseId: string;
  readonly stratum: string;
  readonly message: string;
}

export interface LayerCProgress {
  readonly done: number;
  readonly total: number;
  readonly cached: number;
  readonly errors: number;
}

export interface LayerCOptions {
  /** The model provider. `null` clears it, and `judgeOne` then throws. */
  readonly llm: LlmProvider | null;
  /** Real property submissions, as rolled-up facts. Judged before generated cases. */
  readonly realCases?: readonly LayerCRealCase[];
  readonly onProgress?: (progress: LayerCProgress) => void;
}

/** What the last `runLayerC` produced beyond the frozen summary. */
export interface LayerCRunDetail {
  readonly results: readonly LayerCCaseResult[];
  readonly errors: readonly LayerCCaseError[];
  readonly realCases: number;
  readonly generatedCases: number;
  readonly cachedCases: number;
  /** Cases where the verdict agreed and the deciding factor matched too. */
  readonly decidingFactorAgreed: number;
}

interface CaseContext {
  readonly stratum: string;
  readonly engine: EngineResultView;
}

interface CacheEntry {
  readonly version: number;
  readonly caseId: string;
  readonly promptKey: string;
  readonly provider: string;
  readonly judgement: LayerCJudgement;
}

interface ActiveRun {
  readonly cacheDir: string;
  readonly resume: boolean;
}

let options: LayerCOptions = { llm: null };
let active: ActiveRun | null = null;
const registry = new Map<string, CaseContext>();
let lastDetail: LayerCRunDetail | null = null;

export function configureLayerC(next: LayerCOptions): void {
  options = next;
}

/** The detail of the most recent completed `runLayerC`, or null. */
export function lastLayerCRun(): LayerCRunDetail | null {
  return lastDetail;
}

export async function runLayerC(config: LayerCConfig): Promise<LayerCSummary> {
  const concurrency = Math.max(1, Math.floor(Number.isFinite(config.concurrency) ? config.concurrency : 1));
  const { cases, planErrors } = planCases(config);

  registry.clear();
  for (const c of cases) registry.set(c.caseId, { stratum: c.stratum, engine: c.engine });

  await mkdir(config.cacheDir, { recursive: true });
  await mkdir(config.outDir, { recursive: true });

  const results: (LayerCCaseResult | null)[] = new Array<LayerCCaseResult | null>(cases.length).fill(null);
  const errors: (LayerCCaseError | null)[] = new Array<LayerCCaseError | null>(cases.length).fill(null);
  let next = 0;
  let done = 0;
  let cachedCount = 0;
  let errorCount = planErrors.length;

  active = { cacheDir: config.cacheDir, resume: config.resume };
  try {
    const lane = async (): Promise<void> => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= cases.length) return;
        const c = cases[i]!;
        try {
          const r = await judgeOne(c.caseId, c.factsText);
          results[i] = r;
          if (r.cached) cachedCount += 1;
        } catch (error) {
          errors[i] = { caseId: c.caseId, stratum: c.stratum, message: messageOf(error) };
          errorCount += 1;
        }
        done += 1;
        options.onProgress?.({ done, total: cases.length, cached: cachedCount, errors: errorCount });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, cases.length)) }, lane));
  } finally {
    active = null;
  }

  const answered = results.filter((r): r is LayerCCaseResult => r !== null);
  const summary = summarize(answered, cases);
  const realCount = cases.filter((c) => c.stratum === REAL_STRATUM).length;
  lastDetail = {
    results: answered,
    errors: [...planErrors, ...errors.filter((e): e is LayerCCaseError => e !== null)],
    realCases: realCount + planErrors.filter((e) => e.stratum === REAL_STRATUM).length,
    generatedCases: cases.length - realCount + planErrors.filter((e) => e.stratum !== REAL_STRATUM).length,
    cachedCases: cachedCount,
    decidingFactorAgreed: answered.filter(
      (r) => r.agreed && r.model.decidingFactor === (r.engine.decidingFactorId ?? 'none'),
    ).length,
  };

  await writeJsonAtomic(join(config.outDir, 'layer-c.json'), {
    config,
    summary,
    realCases: lastDetail.realCases,
    generatedCases: lastDetail.generatedCases,
    cachedCases: lastDetail.cachedCases,
    decidingFactorAgreed: lastDetail.decidingFactorAgreed,
    errors: lastDetail.errors,
    results: answered,
  });
  return summary;
}

/**
 * One case: the cached judgement when the run resumes and the prompt is
 * unchanged, otherwise one `second-opinion` call. The case must have been
 * registered by `runLayerC` (that is where its stratum and engine result
 * come from); the model sees only the guideline brief and `factsText`.
 */
export async function judgeOne(caseId: string, factsText: string): Promise<LayerCCaseResult> {
  const ctx = registry.get(caseId);
  if (ctx === undefined) {
    throw new Error(`layer C: case ${caseId} is not registered; run it through runLayerC`);
  }
  const guideline = guidelineBrief();
  const promptKey = sha256(`${guideline}\n\u0000\n${factsText}`);
  const run = active;

  const llm = options.llm;
  if (run !== null && run.resume) {
    // A judgement from a different provider (say the offline fake) never
    // stands in for the real model's.
    const hit = await readCache(run.cacheDir, caseId, promptKey, llm?.name ?? null);
    if (hit !== null) return result(caseId, ctx, hit, true);
  }

  if (llm === null) throw new Error('layer C: no LLM provider configured (call configureLayerC)');
  const out = await secondOpinionCall(llm, {
    guidelineText: guideline,
    facts: factsRecord(factsText),
  });
  const judgement: LayerCJudgement = {
    verdict: out.verdict,
    decidingFactor: out.decidingFactor,
    reasoning: out.reasoning,
  };
  if (run !== null) {
    const entry: CacheEntry = { version: CACHE_VERSION, caseId, promptKey, provider: llm.name, judgement };
    await writeJsonAtomic(cachePath(run.cacheDir, caseId), entry);
  }
  return result(caseId, ctx, judgement, false);
}

/* ------------------------------------------------------------ private */

interface PlannedCase {
  readonly caseId: string;
  readonly stratum: string;
  readonly factsText: string;
  readonly engine: EngineResultView;
}

function planCases(config: LayerCConfig): {
  readonly cases: PlannedCase[];
  readonly planErrors: LayerCCaseError[];
} {
  const out: PlannedCase[] = [];
  const planErrors: LayerCCaseError[] = [];
  const seen = new Set<string>();
  const push = (testCase: GeneratedCase, stratum: string): void => {
    if (seen.has(testCase.caseId)) {
      throw new Error(`layer C: duplicate case id ${testCase.caseId}`);
    }
    seen.add(testCase.caseId);
    let engine: EngineResultView;
    try {
      engine = engineView(testCase.input);
    } catch (error) {
      // An engine throw is a layer-B finding; here it only means no comparison.
      planErrors.push({ caseId: testCase.caseId, stratum, message: `engine threw: ${messageOf(error)}` });
      return;
    }
    out.push({ caseId: testCase.caseId, stratum, factsText: factsForCase(testCase).text, engine });
  };

  for (const real of options.realCases ?? []) {
    push(
      {
        caseId: real.caseId.startsWith('real:') ? real.caseId : `real:${real.caseId}`,
        seed: 0,
        index: 0,
        input: real.input,
        boundaries: {},
        fromSubmission: true,
      },
      REAL_STRATUM,
    );
  }
  const generated = Math.max(0, Math.floor(Number.isFinite(config.generatedCount) ? config.generatedCount : 0));
  for (const s of stratifiedSample(config.seed, generated)) push(s.case, s.stratum);
  return { cases: out, planErrors };
}

/**
 * The facts text as the `second-opinion` call's key/value record: one entry
 * per `- Label: value` line (the call renders each on its own line, sorted by
 * label). Any line that is not in that form is kept verbatim under a numbered
 * key, so nothing in the text is ever dropped.
 */
function factsRecord(factsText: string): Record<string, string> {
  const facts: Record<string, string> = {};
  let n = 0;
  for (const line of factsText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.endsWith(':')) continue;
    const m = /^- (.+?): (.*)$/.exec(trimmed);
    if (m !== null && !(m[1]! in facts)) {
      facts[m[1]!] = m[2]!;
    } else {
      n += 1;
      facts[`Note ${n}`] = trimmed;
    }
  }
  return facts;
}

function engineView(input: NaiveInput): EngineResultView {
  const v = engineViewForInput(input);
  return {
    appetiteScore: v.appetiteScore,
    completeness: v.completeness,
    verdict: v.verdict,
    knockoutFactorIds: v.knockoutFactorIds,
    decidingFactorId: v.decidingFactorId,
    tierValuesByFactor: v.tierValuesByFactor,
  };
}

function result(
  caseId: string,
  ctx: CaseContext,
  model: LayerCJudgement,
  cached: boolean,
): LayerCCaseResult {
  // PRD §12 asks whether a careful reader reaches the same verdict; the
  // deciding factor is reported alongside, not part of agreement.
  return { caseId, stratum: ctx.stratum, engine: ctx.engine, model, agreed: model.verdict === ctx.engine.verdict, cached };
}

function summarize(answered: readonly LayerCCaseResult[], planned: readonly PlannedCase[]): LayerCSummary {
  const agreed = answered.filter((r) => r.agreed).length;
  const order = [REAL_STRATUM, ...strata().map((s) => s.key)];
  const present = new Set(planned.map((c) => c.stratum));
  for (const c of planned) if (!order.includes(c.stratum)) order.push(c.stratum);
  const byStratum = order
    .filter((key) => present.has(key))
    .map((stratum) => {
      const rows = answered.filter((r) => r.stratum === stratum);
      return { stratum, total: rows.length, agreed: rows.filter((r) => r.agreed).length };
    });
  return {
    total: answered.length,
    agreed,
    agreement: wilsonInterval(agreed, answered.length),
    byStratum,
    disagreements: answered.filter((r) => !r.agreed),
  };
}

const VERDICTS: readonly NaiveVerdict[] = ['FIT', 'REFER', 'DOES_NOT_FIT'];

async function readCache(
  dir: string,
  caseId: string,
  promptKey: string,
  provider: string | null,
): Promise<LayerCJudgement | null> {
  let raw: string;
  try {
    raw = await readFile(cachePath(dir, caseId), 'utf8');
  } catch {
    return null;
  }
  try {
    const e = JSON.parse(raw) as Partial<CacheEntry> | null;
    const j = e?.judgement;
    if (
      e === null ||
      e.version !== CACHE_VERSION ||
      e.caseId !== caseId ||
      e.promptKey !== promptKey ||
      (provider !== null && e.provider !== provider) ||
      j === undefined ||
      !VERDICTS.includes(j.verdict) ||
      typeof j.decidingFactor !== 'string' ||
      typeof j.reasoning !== 'string'
    ) {
      return null;
    }
    return { verdict: j.verdict, decidingFactor: j.decidingFactor, reasoning: j.reasoning };
  } catch {
    // A torn or hand-edited entry is a miss, never a crash.
    return null;
  }
}

function cachePath(dir: string, caseId: string): string {
  const safe = caseId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  return join(dir, `${safe}-${sha256(caseId).slice(0, 12)}.json`);
}

let tmpCounter = 0;

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  tmpCounter += 1;
  const tmp = `${path}.${process.pid}.${tmpCounter}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
