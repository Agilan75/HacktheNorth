/**
 * Portfolio numbers plus the verification headline, read from
 * `packages/verify/out/summary.json`. Unit A19.
 *
 * Every number here is counted or taken straight from a stored `EngineResult`
 * (PRD §8: results are stored unchanged, nothing re-derives a score). The only
 * arithmetic is counting, bucketing and the book-adequacy median.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AggregateDto } from '@retrofit/contracts';
import { ADEQUACY_UNDERPRICED, math } from '@retrofit/engine';
import type { AppetiteFactorId, EngineResult, Verdict } from '@retrofit/engine';
import { guidelineRows } from '@retrofit/federato';
import { createRepos } from '../db/repos';
import type { SubmissionRow } from '../db/schema';
import type { Deps } from './types';

export async function aggregate(deps: Deps): Promise<AggregateDto> {
  const rows = createRepos(deps.db).submissions.all();
  const verification = await readVerification();
  return { ...portfolio(rows), verification };
}

/* ------------------------------------------------------------ private */

type Verification = NonNullable<AggregateDto['verification']>;

/**
 * `apps/api/{src,dist}/services/aggregate.{ts,js}` → repo root is four levels up,
 * so the same relative URL works from source (tsx, vitest) and from `dist`.
 */
const SUMMARY_URL = new URL('../../../../packages/verify/out/summary.json', import.meta.url);

/** The canonical factor order (AG p2 row order); ties in the knockout list follow it. */
const FACTOR_ORDER: readonly AppetiteFactorId[] = [
  'submission_type',
  'line_of_business',
  'primary_risk_state',
  'tiv',
  'total_premium',
  'building_age',
  'construction_type',
  'loss_value',
];

const HISTOGRAM_BUCKETS = 10;

/**
 * The `AggregateDto.verification` keys of summary.json (V07 decision 4 writes them
 * at the top level). Extra keys are detail the DTO does not carry and are dropped.
 */
const verificationSchema = z.object({
  propertyCasesRun: z.number().int().nonnegative(),
  differentialCasesRun: z.number().int().nonnegative(),
  disagreements: z.number().int().nonnegative(),
  llmCasesRun: z.number().int().nonnegative(),
  llmAgreementRate: z.number().nullable(),
  llmAgreementCi95: z.tuple([z.number(), z.number()]).nullable(),
  extractionFieldAccuracy: z.number().nullable(),
  generatedAt: z.string().min(10).max(40),
});

/**
 * Null when no verify run has written the file yet (the DTO's documented case).
 * A file that exists but is not valid JSON or lacks the DTO keys throws: a
 * corrupt headline is a bug to surface, not a number to hide.
 */
async function readVerification(): Promise<Verification | null> {
  let text: string;
  try {
    text = await readFile(fileURLToPath(SUMMARY_URL), 'utf8');
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`aggregate: packages/verify/out/summary.json is not valid JSON: ${String(err)}`);
  }
  const parsed = verificationSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `aggregate: packages/verify/out/summary.json is missing verification fields: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }
  const v = parsed.data;
  return {
    propertyCasesRun: v.propertyCasesRun,
    differentialCasesRun: v.differentialCasesRun,
    disagreements: v.disagreements,
    llmCasesRun: v.llmCasesRun,
    llmAgreementRate: v.llmAgreementRate,
    llmAgreementCi95: v.llmAgreementCi95 ? [v.llmAgreementCi95[0], v.llmAgreementCi95[1]] : null,
    extractionFieldAccuracy: v.extractionFieldAccuracy,
    generatedAt: v.generatedAt,
  };
}

function isMissingFile(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function portfolio(rows: readonly SubmissionRow[]): Omit<AggregateDto, 'verification'> {
  const byVerdict: Record<Verdict, number> = { FIT: 0, REFER: 0, DOES_NOT_FIT: 0 };
  const byLine: Record<string, number> = {};
  const histogram: number[] = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
  const knockoutCounts = new Map<string, number>();
  const oneFlip: (AggregateDto['oneFlipAway'][number] & { readonly rank: number | null })[] = [];
  const adequacies: number[] = [];
  let scored = 0;
  let knockedOut = 0;

  for (const row of rows) {
    byLine[row.lineOfBusiness] = (byLine[row.lineOfBusiness] ?? 0) + 1;
    const result: EngineResult | null = row.result;
    if (!result) continue;

    scored += 1;
    byVerdict[result.verdict.verdict] += 1;

    const score = result.evaluate.appetiteScore;
    histogram[bucketOf(score)] = (histogram[bucketOf(score)] ?? 0) + 1;

    if (result.evaluate.knockout) knockedOut += 1;
    for (const factor of new Set(result.evaluate.knockoutFactors)) {
      knockoutCounts.set(factor, (knockoutCounts.get(factor) ?? 0) + 1);
    }

    // INTERPRETATIONS V-9: distance 1 = exactly one move; F-6: the flip lands on FIT.
    const f = result.flip.flip;
    const first = f?.moves[0];
    if (
      result.verdict.verdict !== 'FIT' &&
      result.verdict.distanceToAppetite === 1 &&
      f &&
      first &&
      f.moves.length === 1 &&
      f.verdictAfter === 'FIT'
    ) {
      oneFlip.push({
        id: row.id,
        externalId: row.externalId,
        insuredName: row.insuredName ?? null,
        appetiteScore: score,
        moveLabel: first.label,
        scoreAfter: f.scoreAfter,
        premiumAfter: f.premiumAfter,
        rank: row.rank ?? null,
      });
    }

    // Book adequacy is quoted ÷ predicted (PRD "Price adequacy"); tenant has no quoted premium.
    const adequacy = result.price.adequacy;
    if (result.lineOfBusiness === 'commercial_property' && adequacy !== null && Number.isFinite(adequacy)) {
      adequacies.push(adequacy);
    }
  }

  const labels = factorLabels();
  const topKnockoutFactors = [...knockoutCounts.entries()]
    .sort((a, b) => b[1] - a[1] || factorPos(a[0]) - factorPos(b[0]) || a[0].localeCompare(b[0]))
    .map(([factor, count]) => ({ factor, label: labels.get(factor) ?? factor, count }));

  oneFlip.sort(
    (a, b) =>
      nullsLast(a.rank, b.rank) ||
      b.scoreAfter - a.scoreAfter ||
      a.externalId.localeCompare(b.externalId),
  );

  return {
    counts: { total: rows.length, byVerdict, byLine, scored, knockedOut },
    scoreHistogram: histogram,
    topKnockoutFactors,
    oneFlipAway: oneFlip.map(({ rank: _rank, ...rest }) => rest),
    bookAdequacy: {
      median: math.median(adequacies),
      underpricedCount: adequacies.filter((a) => a < ADEQUACY_UNDERPRICED).length,
      n: adequacies.length,
    },
  };
}

/** `scoreHistogram[0]` = 0–9 … `[9]` = 90–100; out-of-range scores are pinned to the ends. */
function bucketOf(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(HISTOGRAM_BUCKETS - 1, Math.max(0, Math.floor(score / 10)));
}

function factorPos(factor: string): number {
  const i = FACTOR_ORDER.indexOf(factor as AppetiteFactorId);
  return i === -1 ? FACTOR_ORDER.length : i;
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Labels quote the guideline table (AG p2), so the page names factors as the PDF does. */
function factorLabels(): ReadonlyMap<string, string> {
  return new Map(guidelineRows().map((r) => [r.factor as string, r.label]));
}
