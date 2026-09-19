/**
 * Writes packages/verify/out/per-account.json: the verification record of each
 * of the 38 real property accounts, keyed by submission id, so the console can
 * show on an account's own page what the testing said about it.
 *
 * For each account:
 *  (a) layer B on the real account -- the naive second implementation, given
 *      the same rolled-up facts layer C was given (`realInputs`, the rollup
 *      real-inputs.ts writes), compared with the engine's own result on the
 *      account for verdict, appetite score, knockouts and deciding factor;
 *  (b) layer C -- the second-opinion model's verdict, deciding factor and
 *      written reasoning, read from the committed layer-c.json (never re-run:
 *      that costs model calls and needs a key).
 *
 * The API reads the output file at runtime. It cannot import this package:
 * verify already depends on api, so that would be a cycle. (FILL-backend D5)
 *
 * Run: node --import tsx packages/verify/src/scripts/per-account.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineResultView } from '../compare.js';
import { REAL_STRATUM } from '../layer-c.js';
import { naiveEvaluate } from '../naive/index.js';
import type { EngineResultView, LayerCCaseResult, NaiveInput, NaiveResult } from '../types.js';
import { realInputs } from './real-inputs.js';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../out');

/** INTERPRETATIONS §7 SCORE_TOLERANCE, the same tolerance layer B uses. */
const SCORE_TOLERANCE = 1e-6;

/* -------------------------------------------------------------------------- */
/* Output shape                                                               */
/* -------------------------------------------------------------------------- */

export interface OutcomeRecord {
  readonly verdict: 'FIT' | 'REFER' | 'DOES_NOT_FIT';
  readonly appetiteScore: number;
  readonly knockoutFactorIds: readonly string[];
  readonly decidingFactorId: string | null;
}

export interface PerAccountRecord {
  readonly caseId: string;
  /** The as-of date the engine ran at: the account's received date. */
  readonly asOf: string;
  readonly engine: OutcomeRecord;
  readonly naive: OutcomeRecord & {
    readonly agrees: {
      readonly verdict: boolean;
      readonly appetiteScore: boolean;
      readonly knockouts: boolean;
      readonly decidingFactor: boolean;
      readonly all: boolean;
    };
  };
  readonly secondOpinion: {
    readonly verdict: 'FIT' | 'REFER' | 'DOES_NOT_FIT';
    readonly decidingFactor: string;
    readonly reasoning: string;
    readonly agreed: boolean;
    readonly decidingFactorAgreed: boolean;
    readonly engine: OutcomeRecord;
  } | null;
}

export interface PerAccountFile {
  readonly generatedAt: string;
  readonly sources: {
    readonly facts: string;
    readonly naive: string;
    readonly layerC: string;
  };
  readonly summary: {
    readonly total: number;
    readonly naiveAgreedAll: number;
    readonly secondOpinionAnswered: number;
    readonly secondOpinionAgreed: number;
  };
  readonly accounts: Readonly<Record<string, PerAccountRecord>>;
}

/** What the builder needs about one real account. */
export interface RealAccountInput {
  readonly caseId: string;
  readonly asOf: string;
  readonly input: NaiveInput;
  readonly engine: EngineResultView;
}

/* -------------------------------------------------------------------------- */
/* Pure builder                                                               */
/* -------------------------------------------------------------------------- */

function outcome(view: {
  readonly verdict: OutcomeRecord['verdict'];
  readonly appetiteScore: number;
  readonly knockoutFactorIds: readonly string[];
  readonly decidingFactorId: string | null;
}): OutcomeRecord {
  return {
    verdict: view.verdict,
    appetiteScore: view.appetiteScore,
    knockoutFactorIds: [...new Set(view.knockoutFactorIds)].sort(),
    decidingFactorId: view.decidingFactorId ?? null,
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function naiveRecord(engine: EngineResultView, naive: NaiveResult): PerAccountRecord['naive'] {
  const agrees = {
    verdict: engine.verdict === naive.verdict,
    appetiteScore: Math.abs(engine.appetiteScore - naive.appetiteScore) <= SCORE_TOLERANCE,
    knockouts: sameSet(engine.knockoutFactorIds, naive.knockoutFactorIds),
    decidingFactor: (engine.decidingFactorId ?? null) === (naive.decidingFactorId ?? null),
  };
  return {
    ...outcome(naive),
    agrees: { ...agrees, all: agrees.verdict && agrees.appetiteScore && agrees.knockouts && agrees.decidingFactor },
  };
}

/** The layer-C real-account results, keyed by submission id (`real:SUB-…` → `SUB-…`). */
export function layerCRealByCase(results: readonly LayerCCaseResult[]): ReadonlyMap<string, LayerCCaseResult> {
  const out = new Map<string, LayerCCaseResult>();
  for (const r of results) {
    if (r.stratum !== REAL_STRATUM) continue;
    const id = r.caseId.startsWith('real:') ? r.caseId.slice('real:'.length) : r.caseId;
    out.set(id, r);
  }
  return out;
}

export function buildPerAccount(
  accounts: readonly RealAccountInput[],
  layerC: ReadonlyMap<string, LayerCCaseResult>,
  generatedAt: string,
  naive: (input: NaiveInput) => NaiveResult = naiveEvaluate,
): PerAccountFile {
  const records: Record<string, PerAccountRecord> = {};
  const sorted = [...accounts].sort((a, b) => a.caseId.localeCompare(b.caseId));
  for (const a of sorted) {
    const c = layerC.get(a.caseId);
    records[a.caseId] = {
      caseId: a.caseId,
      asOf: a.asOf,
      engine: outcome(a.engine),
      naive: naiveRecord(a.engine, naive(a.input)),
      secondOpinion:
        c === undefined
          ? null
          : {
              verdict: c.model.verdict,
              decidingFactor: c.model.decidingFactor,
              reasoning: c.model.reasoning,
              agreed: c.agreed,
              decidingFactorAgreed: c.model.decidingFactor === (c.engine.decidingFactorId ?? null),
              engine: outcome(c.engine),
            },
    };
  }
  const list = Object.values(records);
  return {
    generatedAt,
    sources: {
      facts: 'packages/verify/src/scripts/real-inputs.ts',
      naive: 'packages/verify/src/naive/index.ts',
      layerC: 'packages/verify/out/layer-c.json',
    },
    summary: {
      total: list.length,
      naiveAgreedAll: list.filter((r) => r.naive.agrees.all).length,
      secondOpinionAnswered: list.filter((r) => r.secondOpinion !== null).length,
      secondOpinionAgreed: list.filter((r) => r.secondOpinion?.agreed === true).length,
    },
    accounts: records,
  };
}

/* -------------------------------------------------------------------------- */
/* I/O                                                                        */
/* -------------------------------------------------------------------------- */

/** The committed layer-C results. Absent file → no second opinion anywhere. */
export function readLayerCResults(file = join(OUT, 'layer-c.json')): readonly LayerCCaseResult[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const parsed = JSON.parse(text) as { results?: unknown };
  return Array.isArray(parsed.results) ? (parsed.results as LayerCCaseResult[]) : [];
}

/** The 38 real accounts with the engine's view of each, from the shared rollup. */
export async function realAccountInputs(): Promise<readonly RealAccountInput[]> {
  return (await realInputs()).map((r) => ({
    caseId: r.caseId,
    asOf: r.asOf,
    input: r.input,
    engine: engineResultView(r.result),
  }));
}

export async function main(): Promise<number> {
  const file = buildPerAccount(
    await realAccountInputs(),
    layerCRealByCase(readLayerCResults()),
    new Date().toISOString(),
  );
  const path = join(OUT, 'per-account.json');
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  const s = file.summary;
  console.log(
    `per-account: ${s.total} real accounts -> ${path}; naive agrees on all four with the engine on ${s.naiveAgreedAll}, second opinion answered ${s.secondOpinionAnswered} and agreed on ${s.secondOpinionAgreed}.`,
  );
  return s.total === 38 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
