/**
 * Writes packages/verify/out/real-inputs.json: the 38 real property
 * submissions as rolled-up FACTS for layer C (PRD 12), `[{ caseId, input }]`.
 *
 * Layer C asks Gemini, given only the guideline text and these facts, for a
 * verdict. To make any disagreement a pure question of JUDGEMENT, the facts are
 * exactly the ones the engine scored on: its rollup, and whether it found an
 * open HIGH contradiction. Nothing here reads a verdict, a score, a tier or a
 * deciding factor from the engine -- those are what layer C checks. The rollup
 * itself is cross-checked against an independent hand rollup by integration
 * test I1 on all 27 policies. (DECISIONS CP2-1)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readRatingTable,
  readRulebook,
  readVectorSpec,
  runEngine,
} from '@retrofit/engine';
import type { EngineConfig, EngineResult } from '@retrofit/engine';
import { realCases } from '../../../engine/src/fixtures/real.js';
import { bestValue } from '../../../engine/src/util/fields.js';
import type { NaiveInput } from '../types.js';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../out');

function value<T>(field: Parameters<typeof bestValue<T>>[0]): T | null {
  const best = bestValue(field);
  return best === null ? null : best.value;
}

/** One real property account: the facts layer C and the naive oracle read, and the engine run they came from. */
export interface RealInput {
  readonly caseId: string;
  readonly input: NaiveInput;
  readonly asOf: string;
  readonly result: EngineResult;
}

/**
 * The 38 real property accounts, each run through the engine once and rolled
 * up into the naive input. Shared by this script (layer C's facts) and
 * `per-account.ts` (layer B on the real accounts), so both read the same facts.
 */
export async function realInputs(): Promise<readonly RealInput[]> {
  const config: EngineConfig = {
    spec: await readVectorSpec('commercial_property'),
    rulebook: await readRulebook('commercial'),
    extensions: await readRulebook('extensions'),
    ratingTable: await readRatingTable('commercial_property'),
    bookStats: null,
  };
  const out: RealInput[] = [];
  for (const c of realCases()) {
    const asOf = value<string>(c.submission.receivedDate) ?? value<string>(c.submission.effectiveDate);
    if (asOf === null) throw new Error(`${c.externalId}: no date`);
    const r = runEngine({ submission: c.submission, asOf }, config);
    const roll = r.rollup;
    const hasBuildings = roll.buildingCount > 0;
    out.push({
      caseId: c.externalId,
      asOf,
      result: r,
      input: {
        submissionType: value<string>(c.submission.submissionType ?? []),
        lineOfBusiness: c.submission.lineOfBusiness,
        primaryState: roll.primaryState,
        totalTiv: roll.totalTiv,
        quotedPremium: value<number>(c.submission.pricing.quotedPremium ?? []),
        pctTivPre1990: roll.pctTivPre1990,
        pctTivPost2010: roll.pctTivPost2010,
        pctTivAcceptableConstruction: roll.pctTivAcceptableConstruction,
        fiveYearLoss: roll.fiveYearLoss,
        anyBuildingPre1990: hasBuildings ? roll.pre1990BuildingIds.length > 0 : null,
        hasOpenHighContradiction: r.contradictions.some((x) => x.severity === 'HIGH' && x.status === 'open'),
      },
    });
  }
  return out;
}

export async function main(): Promise<number> {
  const out = (await realInputs()).map(({ caseId, input }) => ({ caseId, input }));
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, 'real-inputs.json');
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`real-inputs: wrote ${out.length} real property cases to ${file}`);
  return out.length === 38 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
