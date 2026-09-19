import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EngineResultView, LayerCCaseResult, NaiveInput, NaiveResult } from '../types.js';
import type { PerAccountFile } from './per-account.js';
import {
  buildPerAccount,
  layerCRealByCase,
  readLayerCResults,
  realAccountInputs,
} from './per-account.js';

const COMMITTED = fileURLToPath(new URL('../../out/per-account.json', import.meta.url));

const INPUT: NaiveInput = {
  submissionType: 'new_business',
  lineOfBusiness: 'commercial_property',
  primaryState: 'CA',
  totalTiv: 60_000_000,
  quotedPremium: 80_000,
  pctTivPre1990: 0,
  pctTivPost2010: 1,
  pctTivAcceptableConstruction: 1,
  fiveYearLoss: 0,
  anyBuildingPre1990: false,
  hasOpenHighContradiction: false,
};

const ENGINE: EngineResultView = {
  appetiteScore: 88,
  completeness: 100,
  verdict: 'FIT',
  knockoutFactorIds: [],
  decidingFactorId: 'tiv',
  tierValuesByFactor: {},
};

const naiveOf =
  (over: Partial<NaiveResult>) =>
  (): NaiveResult => ({
    appetiteScore: 88,
    completeness: 100,
    verdict: 'FIT',
    knockoutFactorIds: [],
    referReasons: [],
    decidingFactorId: 'tiv',
    factors: [],
    ...over,
  });

const layerC = (caseId: string, over: Partial<LayerCCaseResult> = {}): LayerCCaseResult => ({
  caseId,
  stratum: 'real_property',
  engine: ENGINE,
  model: { verdict: 'FIT', decidingFactor: 'tiv', reasoning: 'All factors pass; TIV is the weakest.' },
  agreed: true,
  cached: true,
  ...over,
});

describe('buildPerAccount', () => {
  it('records naive agreement on all four comparisons and the second opinion, keyed by submission id', () => {
    const file = buildPerAccount(
      [{ caseId: 'SUB-1', asOf: '2025-01-01', input: INPUT, engine: ENGINE }],
      layerCRealByCase([layerC('real:SUB-1')]),
      '2026-09-19T00:00:00.000Z',
      naiveOf({}),
    );
    const r = file.accounts['SUB-1']!;
    expect(r.naive.agrees).toEqual({ verdict: true, appetiteScore: true, knockouts: true, decidingFactor: true, all: true });
    expect(r.secondOpinion).toMatchObject({ verdict: 'FIT', decidingFactor: 'tiv', agreed: true, decidingFactorAgreed: true });
    expect(r.secondOpinion!.reasoning).toContain('TIV');
    expect(file.summary).toEqual({ total: 1, naiveAgreedAll: 1, secondOpinionAnswered: 1, secondOpinionAgreed: 1 });
  });

  it('reports each kind of naive disagreement separately', () => {
    const file = buildPerAccount(
      [{ caseId: 'SUB-2', asOf: '2025-01-01', input: INPUT, engine: ENGINE }],
      new Map(),
      'now',
      naiveOf({ verdict: 'DOES_NOT_FIT', appetiteScore: 70, knockoutFactorIds: ['tiv'], decidingFactorId: 'tiv' }),
    );
    expect(file.accounts['SUB-2']!.naive.agrees).toEqual({
      verdict: false,
      appetiteScore: false,
      knockouts: false,
      decidingFactor: true,
      all: false,
    });
    expect(file.summary.naiveAgreedAll).toBe(0);
  });

  it('leaves the second opinion null when layer C never answered, and ignores generated strata', () => {
    const file = buildPerAccount(
      [{ caseId: 'SUB-3', asOf: '2025-01-01', input: INPUT, engine: ENGINE }],
      layerCRealByCase([layerC('V03:1:1', { stratum: 'tiv_at_150m' })]),
      'now',
      naiveOf({}),
    );
    expect(file.accounts['SUB-3']!.secondOpinion).toBeNull();
    expect(file.summary.secondOpinionAnswered).toBe(0);
  });

  it('flags a deciding-factor difference inside an agreeing verdict', () => {
    const file = buildPerAccount(
      [{ caseId: 'SUB-4', asOf: '2025-01-01', input: INPUT, engine: ENGINE }],
      layerCRealByCase([layerC('real:SUB-4', { model: { verdict: 'FIT', decidingFactor: 'total_premium', reasoning: 'r' } })]),
      'now',
      naiveOf({}),
    );
    expect(file.accounts['SUB-4']!.secondOpinion).toMatchObject({ agreed: true, decidingFactorAgreed: false });
  });
});

describe('committed per-account.json', () => {
  const committed = JSON.parse(readFileSync(COMMITTED, 'utf8')) as PerAccountFile;

  it('covers all 38 real property accounts', () => {
    expect(Object.keys(committed.accounts)).toHaveLength(38);
    expect(committed.summary.total).toBe(38);
  });

  it('is exactly what the script produces now from the code, the snapshot and layer-c.json', async () => {
    const fresh = buildPerAccount(
      await realAccountInputs(),
      layerCRealByCase(readLayerCResults()),
      committed.generatedAt,
    );
    expect(fresh).toEqual(committed);
  });
});
