/**
 * Re-score: recompute `BookStats`, run the engine over one or every account,
 * then peers and rank across the whole set. Unit A16.
 *
 * Decisions: docs/decisions/A16.md. In short:
 * - The stored `canonical` is the broker record (plus answers applied by the
 *   reply service). Enrichment values live in the `enrichments` table and are
 *   merged in on every run, so a re-score never double-merges.
 * - `BookStats` and peers are computed per line of business (the vectors of
 *   the two lines are not comparable); peers run for commercial property only.
 * - Rank is a 1-based position within the account's own line-of-business queue.
 * - The engine's `result.id` is forced to the row id, so rank ids map to rows.
 */
import type {
  BookStats,
  CanonicalSubmission,
  EngineConfig,
  EngineResult,
  ExternalValue,
  FeatureVector,
  LineOfBusiness,
  PeerVectorEntry,
  Question,
  RatingTable,
  Rulebook,
  Sourced,
  VectorSpec,
} from '@retrofit/engine';
import {
  LOSS_WINDOW_YEARS,
  computeBookStats,
  math,
  peers as peerStage,
  rank,
  readQuestions,
  readRatingTable,
  readRulebook,
  readVectorSpec,
  reduceForCoarseMatch,
  runEngine,
} from '@retrofit/engine';
import { explain } from '@retrofit/federato';
import type { ScoreSnapshotDto } from '@retrofit/contracts';
import { createRepos } from '../db/repos';
import type { Repos } from '../db/repos';
import type { EnrichmentRow, SubmissionRow } from '../db/schema';
import type { Deps } from './types';

export interface RescoreOneInput {
  readonly submissionId: string;
  readonly extra?: readonly ExternalValue[];
}

export interface RescoreOneResult {
  readonly before: ScoreSnapshotDto | null;
  readonly after: ScoreSnapshotDto;
  readonly result: EngineResult;
  readonly rankChanged: boolean;
}

/* -------------------------------------------------------------------------- */
/* Private: engine configuration                                              */
/* -------------------------------------------------------------------------- */

const configCache = new Map<LineOfBusiness, Promise<EngineConfig>>();

async function loadConfig(line: LineOfBusiness): Promise<EngineConfig> {
  const spec: VectorSpec = await readVectorSpec(line);
  const rulebook: Rulebook = await readRulebook(line === 'tenant' ? 'tenant' : 'commercial');
  const ratingTable: RatingTable = await readRatingTable(line);
  // Extensions (sprinklers, protection class) are written for commercial property.
  const extensions: Rulebook | undefined =
    line === 'commercial_property' ? await readRulebook('extensions') : undefined;
  // Questions exist for tenant only (questions/tenant.json).
  let questions: readonly Question[] = [];
  if (line === 'tenant') questions = await readQuestions(line);
  return {
    spec,
    rulebook,
    ratingTable,
    bookStats: null,
    ...(extensions === undefined ? {} : { extensions }),
    questions,
  };
}

/** One load per line per process; a failed load is not cached. */
function configFor(line: LineOfBusiness): Promise<EngineConfig> {
  let hit = configCache.get(line);
  if (hit === undefined) {
    hit = loadConfig(line);
    configCache.set(line, hit);
    hit.catch(() => configCache.delete(line));
  }
  return hit;
}

/* -------------------------------------------------------------------------- */
/* Private: inputs                                                            */
/* -------------------------------------------------------------------------- */

function firstValue<T>(slot: Sourced<T> | undefined): T | null {
  if (slot === undefined) return null;
  for (const field of slot) {
    if (field.value !== null && field.value !== undefined) return field.value;
  }
  return null;
}

/** Enrichment values persisted by the enrich runner: available rows only. */
function storedEnrichment(rows: readonly EnrichmentRow[]): ExternalValue[] {
  const out: ExternalValue[] = [];
  for (const row of rows) {
    if (!row.available) continue;
    const values = (row.payload as { values?: unknown }).values;
    if (!Array.isArray(values)) continue;
    for (const v of values) {
      if (typeof v === 'object' && v !== null && typeof (v as ExternalValue).canonicalPath === 'string') {
        out.push(v as ExternalValue);
      }
    }
  }
  return out;
}

/** The same value from the same source is merged once, whichever list carried it. */
function dedupe(values: readonly ExternalValue[]): ExternalValue[] {
  const seen = new Set<string>();
  const out: ExternalValue[] = [];
  for (const v of values) {
    const key = JSON.stringify([
      v.canonicalPath,
      v.value,
      v.provenance.source,
      v.provenance.sourceDetail ?? null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function engineSubmission(row: SubmissionRow): CanonicalSubmission {
  if (row.canonical === null || row.canonical === undefined) {
    throw new Error(`rescore: submission "${row.id}" has no canonical record to score`);
  }
  // result.id must equal the row id so rank entries map back to rows.
  return { ...row.canonical, id: row.id };
}

function indexOfKey(spec: VectorSpec, key: string): number | undefined {
  return spec.components.find((c) => c.key === key)?.index;
}

function known(vector: FeatureVector, index: number | undefined): number | null {
  if (index === undefined || vector.m[index] !== 1) return null;
  const v = vector.x[index];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * A peer candidate may carry the insured's annual revenue beside its vector
 * (PRD 6.4 coarse match). Revenue is not a vector component, so it never
 * reaches scoring; `peers` reads it only when placing a no-policy account.
 */
type PeerCandidate = PeerVectorEntry & { readonly revenue: number | null };

function revenueOf(submission: CanonicalSubmission): number | null {
  const v = firstValue(submission.insured.revenue);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * A book account as a peer candidate. Rate and annual loss follow the same
 * definitions `computeBookStats` uses: premium per $100 of TIV, and the
 * five-year loss over the five-year window. No quoted premium means no policy,
 * so the account is matched on the reduced vector and labelled coarse.
 */
function peerEntry(
  id: string,
  label: string | null,
  vector: FeatureVector,
  spec: VectorSpec,
  revenue: number | null,
): PeerCandidate {
  const totalTiv = known(vector, indexOfKey(spec, 'totalTiv'));
  const quotedPremium = known(vector, indexOfKey(spec, 'quotedPremium'));
  const fiveYearLoss = known(vector, indexOfKey(spec, 'fiveYearLoss'));
  const coarse = quotedPremium === null;
  return {
    id,
    ...(label === null ? {} : { label }),
    vector: coarse ? reduceForCoarseMatch(vector, spec) : vector,
    totalTiv,
    quotedPremium,
    ratePer100:
      totalTiv === null || quotedPremium === null ? null : math.safeDiv(quotedPremium, totalTiv / 100),
    annualLoss: fiveYearLoss === null ? null : fiveYearLoss / LOSS_WINDOW_YEARS,
    coarse,
    revenue,
  };
}

interface Scorable {
  readonly row: SubmissionRow;
  readonly submission: CanonicalSubmission;
  readonly enrichment: readonly ExternalValue[];
}

function scorable(repos: Repos, row: SubmissionRow, extra: readonly ExternalValue[] = []): Scorable {
  return {
    row,
    submission: engineSubmission(row),
    enrichment: dedupe([...extra, ...storedEnrichment(repos.enrichments.bySubmissionId(row.id))]),
  };
}

/** Stage 6 needs no book statistics: a stats-free, peer-free pass yields the vector. */
function vectorPass(item: Scorable, config: EngineConfig, asOf: string): FeatureVector {
  return runEngine(
    { submission: item.submission, enrichment: item.enrichment, asOf },
    { ...config, bookStats: null },
  ).vector;
}

function fullPass(
  item: Scorable,
  config: EngineConfig,
  bookStats: BookStats,
  peerVectors: readonly PeerVectorEntry[],
  asOf: string,
): EngineResult {
  const isProperty = item.submission.lineOfBusiness === 'commercial_property';
  const result = runEngine(
    {
      submission: item.submission,
      enrichment: item.enrichment,
      asOf,
      ...(isProperty ? { peerVectors } : {}),
    },
    { ...config, bookStats },
  );
  return withExplanation(isProperty ? withCoarsePeers(result, config, bookStats, peerVectors) : result, item.row.insuredName);
}

/**
 * PRD 6.4: an account with no policy has only the reduced vector, which on the
 * live book carries no comparable component, so the engine's own peers pass
 * finds nobody. Re-run peers with the account's merged canonical record, so
 * its requested limit, HQ state and revenue place it among the policy book as
 * a coarse match. Only `peers` changes: the vector, score, price and verdict
 * were computed without these inputs and stay exactly as they are.
 */
function withCoarsePeers(
  result: EngineResult,
  config: EngineConfig,
  bookStats: BookStats,
  peerVectors: readonly PeerVectorEntry[],
): EngineResult {
  if (peerVectors.length === 0) return result;
  const placed = peerStage(result.vector, config.spec, peerVectors, bookStats, undefined, result.canonical);
  if (!placed.coarse) return result;
  return { ...result, peers: placed };
}

/**
 * PRD 7.7's deterministic template, without the rank so the stored text never
 * goes stale when another account moves. A template failure leaves it null.
 */
function withExplanation(result: EngineResult, insuredName: string | null): EngineResult {
  try {
    return { ...result, explanation: explain({ result, insuredName }).text };
  } catch {
    return result;
  }
}

function insuredNameOf(row: SubmissionRow): string | null {
  if (row.insuredName !== null && row.insuredName !== undefined) return row.insuredName;
  return row.canonical ? firstValue(row.canonical.insured.name) : null;
}

/** Rank every scored account of one line; returns id -> 1-based position. */
function rankLine(repos: Repos, line: LineOfBusiness, overrides: ReadonlyMap<string, EngineResult>): Map<string, number> {
  const results: EngineResult[] = [];
  for (const row of repos.submissions.all()) {
    if (row.lineOfBusiness !== line) continue;
    const result = overrides.get(row.id) ?? row.result;
    if (result === null || result === undefined) continue;
    results.push(result.id === row.id ? result : { ...result, id: row.id });
  }
  const ranked = rank(results);
  repos.submissions.setRanks(ranked.map((r) => ({ id: r.id, rank: r.rank })));
  return new Map(ranked.map((r) => [r.id, r.rank]));
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export async function rescoreOne(deps: Deps, input: RescoreOneInput): Promise<RescoreOneResult> {
  const repos = createRepos(deps.db);
  const row = repos.submissions.byId(input.submissionId);
  if (row === null) throw new Error(`rescore: no submission "${input.submissionId}"`);
  const before = row.result ? snapshotOf(row.result, row.rank ?? null) : null;

  const line = row.lineOfBusiness;
  const config = await configFor(line);
  const asOf = deps.clock.today();
  const target = scorable(repos, { ...row, insuredName: insuredNameOf(row) }, input.extra ?? []);
  const targetVector = vectorPass(target, config, asOf);

  // The rest of the book as it stands: stored vectors, or a fresh vector pass
  // for an account that was never scored (or was scored on another spec).
  const peers: PeerVectorEntry[] = [];
  const vectors: FeatureVector[] = [targetVector];
  for (const other of repos.submissions.all()) {
    if (other.id === row.id || other.lineOfBusiness !== line) continue;
    if (other.canonical === null || other.canonical === undefined) continue;
    const stored = other.result?.vector;
    const vector =
      stored !== undefined && stored.specVersion === config.spec.version
        ? stored
        : vectorPass(scorable(repos, other), config, asOf);
    vectors.push(vector);
    peers.push(peerEntry(other.id, insuredNameOf(other), vector, config.spec, revenueOf(engineSubmission(other))));
  }
  const bookStats = computeBookStats(vectors, config.spec);

  const result = fullPass(target, config, bookStats, peers, asOf);
  repos.submissions.update(row.id, {
    result,
    insuredName: target.row.insuredName,
    updatedAt: deps.clock.nowIso(),
  });

  const ranks = rankLine(repos, line, new Map([[row.id, result]]));
  const newRank = ranks.get(row.id) ?? null;
  const after = snapshotOf(result, newRank);
  return {
    before,
    after,
    result,
    rankChanged: before === null ? newRank !== null : before.rank !== newRank,
  };
}

/** Re-runs peers and rank across the book and writes the new positions. */
export async function rescoreBook(deps: Deps): Promise<number> {
  const repos = createRepos(deps.db);
  const asOf = deps.clock.today();
  const nowIso = deps.clock.nowIso();

  const byLine = new Map<LineOfBusiness, SubmissionRow[]>();
  for (const row of repos.submissions.all()) {
    if (row.canonical === null || row.canonical === undefined) continue;
    const bucket = byLine.get(row.lineOfBusiness);
    if (bucket === undefined) byLine.set(row.lineOfBusiness, [row]);
    else bucket.push(row);
  }

  let scored = 0;
  const lines = [...byLine.keys()].sort();
  for (const line of lines) {
    const rows = byLine.get(line) ?? [];
    const config = await configFor(line);

    // Pass 1: every vector, then the book statistics over all of them.
    const items = rows.map((row) => scorable(repos, { ...row, insuredName: insuredNameOf(row) }));
    const vectors = items.map((item) => vectorPass(item, config, asOf));
    const bookStats = computeBookStats(vectors, config.spec);
    const entries = items.map((item, i) =>
      peerEntry(item.row.id, item.row.insuredName, vectors[i]!, config.spec, revenueOf(item.submission)),
    );

    // Pass 2: the full engine with the book's statistics and everyone else as peers.
    const results = new Map<string, EngineResult>();
    items.forEach((item, i) => {
      const others = entries.filter((_, j) => j !== i);
      const result = fullPass(item, config, bookStats, others, asOf);
      results.set(item.row.id, result);
      repos.submissions.update(item.row.id, {
        result,
        insuredName: item.row.insuredName,
        updatedAt: nowIso,
      });
    });
    scored += results.size;

    // Pass 3: rank the line.
    rankLine(repos, line, results);
  }
  return scored;
}

export function snapshotOf(result: EngineResult, rank: number | null): ScoreSnapshotDto {
  return {
    appetiteScore: result.evaluate.appetiteScore,
    verdict: result.verdict.verdict,
    completeness: result.evaluate.completeness,
    confidence: result.evaluate.confidence,
    predictedPremium: result.price.predictedPremium,
    qualityIndex: result.qualityIndex,
    rank,
  };
}
