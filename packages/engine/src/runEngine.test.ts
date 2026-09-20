/**
 * E16 — `runEngine` over the synthetic fixtures. Every case is run through
 * stages 3-11 on the real `vectors/commercial.json` and `rules/commercial.json`
 * (+ `rules/extensions.json`), and checked against the numbers
 * INTERPRETATIONS.md §8 fixes: vector, appetite score, verdict, completeness.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runEngine } from './runEngine.js';
import { syntheticCases } from './fixtures/synthetic.js';
import { RATIO_TOLERANCE, SCORE_TOLERANCE } from './constants.js';
import type {
  CanonicalSubmission,
  CommercialRatingTable,
  EngineConfig,
  EngineResult,
  PeerVectorEntry,
  Rulebook,
  VectorSpec,
} from './types.js';

function json<T>(rel: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as T;
}

const SPEC = json<VectorSpec>('../vectors/commercial.json');
const RULEBOOK = json<Rulebook>('../rules/commercial.json');
const EXTENSIONS = json<Rulebook>('../rules/extensions.json');

/** A small monotonic table; rating/commercial.json is frozen later by E17. */
const TABLE: CommercialRatingTable = {
  lineOfBusiness: 'commercial_property',
  version: 'synthetic-1',
  baseRate: 0.1,
  construction: {
    fire_resistive: 0.8,
    modified_fire_resistive: 0.85,
    non_combustible: 0.9,
    masonry_non_combustible: 0.9,
    steel: 0.9,
    joisted_masonry: 1,
    frame: 1.3,
  },
  age: [
    { key: 'pre1990', upTo: 1989, factor: 1.3 },
    { key: '1990-2009', upTo: 2009, factor: 1 },
    { key: '2010+', upTo: null, factor: 0.9 },
  ],
  protectionClass: [
    { key: '1-4', upTo: 4, factor: 0.9 },
    { key: '5-8', upTo: 8, factor: 1 },
    { key: '9-10', upTo: null, factor: 1.4 },
  ],
  sprinkler: { sprinklered: 0.8, unsprinklered: 1 },
  lossHistory: [
    { key: 'clean', upTo: 0, factor: 0.9 },
    { key: 'light', upTo: 100_000, factor: 1 },
    { key: 'heavy', upTo: null, factor: 1.5 },
  ],
  credibilityK: 5,
};

const CONFIG: EngineConfig = {
  spec: SPEC,
  rulebook: RULEBOOK,
  extensions: EXTENSIONS,
  ratingTable: TABLE,
  bookStats: null,
};

const AS_OF = '2025-09-19';

function run(id: string, peerVectors?: readonly PeerVectorEntry[]): EngineResult {
  const c = syntheticCases().find((s) => s.id === id);
  if (c === undefined) throw new Error(`no synthetic case ${id}`);
  return runEngine({ submission: c.submission, asOf: AS_OF, ...(peerVectors ? { peerVectors } : {}) }, CONFIG);
}

describe('syntheticCases', () => {
  const cases = syntheticCases();

  it('has unique ids and covers B1..B12, all-missing and extreme', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i <= 12; i += 1) expect(ids).toContain(`SYN-B${String(i)}`);
    expect(ids).toContain('SYN-EMPTY');
    expect(ids).toContain('SYN-EXTREME');
  });

  it('pins the §8 scores', () => {
    const score = Object.fromEntries(cases.map((c) => [c.id, c.expectedAppetite]));
    expect(score['SYN-B1']).toBe(84);
    expect(score['SYN-B6']).toBe(84);
    expect(score['SYN-B8']).toBe(88);
    expect(score['SYN-B9']).toBe(96);
    expect(score['SYN-B10']).toBe(90);
    expect(score['SYN-B11']).toBe(81);
    expect(score['SYN-B12']).toBe(86);
    expect(score['SYN-PERFECT']).toBe(100);
  });

  it('expected vectors are well formed: x/t null exactly where m = 0', () => {
    for (const c of cases) {
      const v = c.expectedVector;
      expect(v.x).toHaveLength(SPEC.components.length);
      expect(v.t).toHaveLength(SPEC.components.length);
      expect(v.m).toHaveLength(SPEC.components.length);
      v.m.forEach((m, i) => {
        if (m === 0) {
          expect(v.x[i]).toBeNull();
          expect(v.t[i]).toBeNull();
        }
      });
    }
  });

  it('is deterministic: two calls produce deep-equal fixtures', () => {
    expect(syntheticCases()).toEqual(syntheticCases());
  });
});

describe('runEngine over every synthetic case', () => {
  for (const c of syntheticCases()) {
    it(`${c.id}: ${c.why}`, () => {
      const r = runEngine({ submission: c.submission, asOf: AS_OF }, CONFIG);

      expect(r.vector.m).toEqual(c.expectedVector.m);
      r.vector.x.forEach((x, i) => {
        const want = c.expectedVector.x[i];
        if (want === null || want === undefined) expect(x).toBeNull();
        else expect(Math.abs((x as number) - want)).toBeLessThanOrEqual(RATIO_TOLERANCE * Math.max(1, Math.abs(want)));
      });
      r.vector.t.forEach((t, i) => {
        const want = c.expectedVector.t[i];
        if (want === null || want === undefined) expect(t).toBeNull();
        else expect(Math.abs((t as number) - want)).toBeLessThanOrEqual(SCORE_TOLERANCE);
      });

      expect(Math.abs(r.evaluate.appetiteScore - c.expectedAppetite)).toBeLessThanOrEqual(SCORE_TOLERANCE);
      expect(r.verdict.verdict).toBe(c.expectedVerdict);
      expect(r.evaluate.knockout).toBe(c.expectedVerdict === 'DOES_NOT_FIT');
    });
  }
});

describe('runEngine composition', () => {
  it('B11: completeness is 8/9 of the required components (V-6)', () => {
    const r = run('SYN-B11');
    expect(Math.abs(r.evaluate.completeness - (100 * 8) / 9)).toBeLessThanOrEqual(RATIO_TOLERANCE);
    expect(r.verdict.missingComponentKeys).toContain('quotedPremium');
  });

  it('B1/B9: fully known accounts are 100% complete; FIT has distance 0 (V-9)', () => {
    for (const id of ['SYN-B1', 'SYN-B9', 'SYN-PERFECT']) {
      const r = run(id);
      expect(r.evaluate.completeness).toBe(100);
      expect(r.verdict.distanceToAppetite).toBe(0);
    }
  });

  it('SYN-EMPTY: completeness 1/9 and five-year loss missing when claims were never fetched', () => {
    const r = run('SYN-EMPTY');
    expect(Math.abs(r.evaluate.completeness - 100 / 9)).toBeLessThanOrEqual(RATIO_TOLERANCE);
    expect(r.rollup.fiveYearLoss).toBeNull();
    expect(r.rollup.totalTiv).toBeNull();
    expect(r.price.predictedPremium).toBeNull();
  });

  it('B6: the refer path names the 1989 building and does not lower the score', () => {
    const r = run('SYN-B6');
    expect(r.rollup.pre1990BuildingIds).toEqual(['SYN-B6-B1']);
    expect(r.evaluate.referFactors).toContain('building_age');
    expect(r.evaluate.knockoutFactors).toEqual([]);
    expect(r.evaluate.appetiteScore).toBeCloseTo(run('SYN-B1').evaluate.appetiteScore, 9);
  });

  it('knockout factors are exactly the ones §8 names', () => {
    expect(run('SYN-B2').evaluate.knockoutFactors).toEqual(['tiv']);
    expect(run('SYN-B3').evaluate.knockoutFactors).toEqual(['total_premium']);
    expect(run('SYN-B4').evaluate.knockoutFactors).toEqual(['loss_value']);
    expect(run('SYN-B5').evaluate.knockoutFactors).toEqual(['construction_type']);
    expect(run('SYN-B7').evaluate.knockoutFactors).toEqual(['building_age']);
    expect(run('SYN-B12').evaluate.knockoutFactors).toEqual(['submission_type']);
  });

  it('attaches the rollup to the canonical submission and carries versions and asOf', () => {
    const r = run('SYN-B1');
    expect(r.canonical.rollup).toEqual(r.rollup);
    expect(r.rollup.totalTiv).toBe(150_000_000);
    expect(r.rollup.primaryState).toBe('OH');
    expect(r.rollup.lossWindow).toEqual({ from: '2020-06-01', to: '2025-06-01' });
    expect(r.id).toBe('SYN-B1');
    expect(r.lineOfBusiness).toBe('commercial_property');
    expect(r.asOf).toBe(AS_OF);
    expect(r.specVersion).toBe(SPEC.version);
    expect(r.rulebookVersion).toBe(RULEBOOK.version);
    expect(r.ratingVersion).toBe('synthetic-1');
    expect(r.peers).toBeNull();
    expect(r.explanation).toBeNull();
  });

  it('prices from the table: B1 = 2 buildings x ($150M/2/100 x 0.1 x class x 1 x 0.9 x 0.8) x loss 1', () => {
    const r = run('SYN-B1');
    const perBuilding = (cls: number): number => (75_000_000 / 100) * 0.1 * cls * 1 * 0.9 * 0.8;
    const want = perBuilding(1) + perBuilding(1.3);
    expect(Math.abs((r.price.predictedPremium as number) - want)).toBeLessThanOrEqual(1e-6);
    expect(r.price.quotedPremium).toBe(175_000);
    expect(Math.abs((r.price.adequacy as number) - 175_000 / want)).toBeLessThanOrEqual(1e-9);
  });

  it('quality index is the P-5 composite of the result it rides on', () => {
    const r = run('SYN-B9');
    expect(r.qualityComponents.appetite).toBeCloseTo(96, 9);
    expect(r.qualityComponents.completeness).toBe(100);
    expect(r.qualityIndex).toBeGreaterThan(0);
    expect(r.qualityIndex).toBeLessThanOrEqual(100);
  });

  it('merge runs before rollup: an answered yearBuilt changes the building-age shares', () => {
    const c = syntheticCases().find((s) => s.id === 'SYN-B1');
    if (c === undefined) throw new Error('missing B1');
    const r = runEngine(
      {
        submission: c.submission,
        asOf: AS_OF,
        answers: [
          {
            canonicalPath: 'buildings.SYN-B1-B1.yearBuilt',
            value: 2015,
            provenance: { source: 'answer', sourceDetail: 'q-yearBuilt' },
          },
          {
            canonicalPath: 'buildings.SYN-B1-B2.yearBuilt',
            value: 2015,
            provenance: { source: 'answer', sourceDetail: 'q-yearBuilt' },
          },
        ],
      },
      CONFIG,
    );
    expect(r.rollup.pctTivPost2010).toBe(1);
    expect(r.vector.t[5]).toBe(1);
  });

  it('runs peers when peer vectors are supplied', () => {
    const other = run('SYN-B9');
    const r = run('SYN-B1', [
      {
        id: 'PEER-1',
        vector: other.vector,
        totalTiv: 50_000_000,
        quotedPremium: 75_000,
        ratePer100: 0.15,
        annualLoss: 20_000,
        coarse: false,
      },
    ]);
    expect(r.peers).not.toBeNull();
    expect(r.peers?.peers.map((p) => p.id)).toEqual(['PEER-1']);
    expect(r.peers?.meanAnnualLoss).toBe(20_000);
  });

  it('is pure: the same input gives a deep-equal result and the input is not mutated', () => {
    const c = syntheticCases().find((s) => s.id === 'SYN-B6');
    if (c === undefined) throw new Error('missing B6');
    const before = JSON.stringify(c.submission);
    const a = runEngine({ submission: c.submission, asOf: AS_OF }, CONFIG);
    const b = runEngine({ submission: c.submission, asOf: AS_OF }, CONFIG);
    expect(a).toEqual(b);
    expect(JSON.stringify(c.submission)).toBe(before);
  });
});

/**
 * R1-2: flip's idea of FIT must be the engine's own verdict. It runs with the
 * extension rulebook, and a zero-move flip never sits on a non-FIT account.
 */
describe('runEngine flip agrees with the verdict (R1-2)', () => {
  function perfect(): CanonicalSubmission {
    const c = syntheticCases().find((s) => s.id === 'SYN-PERFECT');
    if (c === undefined) throw new Error('missing SYN-PERFECT');
    return c.submission;
  }
  const broker = { source: 'self_reported', sourceDetail: 'synthetic' } as const;
  const record = { source: 'enrichment', sourceDetail: 'synthetic' } as const;

  it('baseline: SYN-PERFECT is FIT with a zero-move flip', () => {
    const r = runEngine({ submission: perfect(), asOf: AS_OF }, CONFIG);
    expect(r.verdict.verdict).toBe('FIT');
    expect(r.flip.flip?.moves).toEqual([]);
    expect(r.verdict.distanceToAppetite).toBe(0);
  });

  it('REFER only on an immovable extension rule (X-PPC-UNPROTECTED): no zero-distance flip', () => {
    const base = perfect();
    const submission: CanonicalSubmission = {
      ...base,
      locations: base.locations.map((l) => ({
        ...l,
        protectionClass: [{ value: 9, provenance: broker }],
      })),
    };
    const r = runEngine({ submission, asOf: AS_OF }, CONFIG);
    expect(r.evaluate.knockout).toBe(false);
    expect(r.evaluate.completeness).toBe(100);
    expect(r.evaluate.firedRules.map((f) => f.ruleId)).toContain('X-PPC-UNPROTECTED');
    expect(r.verdict.verdict).toBe('REFER');
    expect(r.flip.flip).toBeNull();
    expect(r.flip.blockedByImmovable).toContain('tivWeightedProtectionClass');
    expect(r.verdict.distanceToAppetite).toBeNull();
  });

  /*
   * The bonus criterion, end to end on the engine: a value that only an
   * external API can supply changes the verdict. `perfect()` is FIT on every
   * guideline factor; adding a FEMA flood zone to its location — which is what
   * the OpenFEMA enrichment writes, and which Federato's schema cannot hold —
   * refers it, and the appetite score is untouched because an extension rule
   * carries no weight.
   */
  it('an enriched FEMA flood zone refers an otherwise-FIT account, without touching its score', () => {
    const base = runEngine({ submission: perfect(), asOf: AS_OF }, CONFIG);
    expect(base.verdict.verdict).toBe('FIT');

    const flooded: CanonicalSubmission = {
      ...perfect(),
      locations: perfect().locations.map((l) => ({
        ...l,
        floodZone: [{ value: 'AE', provenance: { source: 'enrichment' } }],
      })),
    };
    const r = runEngine({ submission: flooded, asOf: AS_OF }, CONFIG);

    expect(r.rollup.worstFloodZoneTier).toBe(1);
    expect(r.evaluate.knockout).toBe(false);
    expect(r.evaluate.firedRules.map((f) => f.ruleId)).toContain('X-FLOOD-SFHA');
    expect(r.verdict.verdict).toBe('REFER');
    // The appetite score is Federato's document alone: an extension rule may
    // refer an account but may never move the number.
    expect(r.evaluate.appetiteScore).toBe(base.evaluate.appetiteScore);
    // The building cannot leave the flood plain, so no flip may propose it.
    expect(r.flip.flip).toBeNull();
    expect(r.flip.blockedByImmovable).toContain('worstFloodZoneTier');
  });

  it('a coastal V zone refers on its own rule, and a dry zone changes nothing', () => {
    const zoned = (zone: string): CanonicalSubmission => ({
      ...perfect(),
      locations: perfect().locations.map((l) => ({
        ...l,
        floodZone: [{ value: zone, provenance: { source: 'enrichment' } }],
      })),
    });

    const coastal = runEngine({ submission: zoned('VE'), asOf: AS_OF }, CONFIG);
    expect(coastal.rollup.worstFloodZoneTier).toBe(2);
    expect(coastal.evaluate.firedRules.map((f) => f.ruleId)).toContain('X-FLOOD-COASTAL');
    expect(coastal.verdict.verdict).toBe('REFER');

    // Zone X is outside the mapped hazard: the account stays exactly as it was.
    const dry = runEngine({ submission: zoned('X'), asOf: AS_OF }, CONFIG);
    expect(dry.rollup.worstFloodZoneTier).toBe(0);
    expect(dry.evaluate.firedRules.map((f) => f.ruleId)).toContain('X-FLOOD-MINIMAL');
    expect(dry.verdict.verdict).toBe('FIT');
    expect(dry.flip.flip?.moves).toEqual([]);
  });

  // flip.ts builds its candidate bounds from the base rulebook only, so a
  // movable extension refer yields no flip (null), never a zero-move FIT.
  it('REFER only on a movable extension rule (X-SPRINKLER-LARGE-UNPROTECTED): no zero-distance flip', () => {
    const base = perfect();
    const submission: CanonicalSubmission = {
      ...base,
      buildings: base.buildings.map((b) => ({
        ...b,
        tiv: [{ value: 60_000_000, provenance: broker }],
        sprinklered: [{ value: false, provenance: broker }],
      })),
    };
    const r = runEngine({ submission, asOf: AS_OF }, CONFIG);
    expect(r.evaluate.knockout).toBe(false);
    expect(r.evaluate.firedRules.map((f) => f.ruleId)).toContain('X-SPRINKLER-LARGE-UNPROTECTED');
    expect(r.verdict.verdict).toBe('REFER');
    expect(r.verdict.distanceToAppetite).not.toBe(0);
    if (r.flip.flip === null) {
      expect(r.flip.reason).not.toBeNull();
      expect(r.verdict.distanceToAppetite).toBeNull();
    } else {
      expect(r.flip.flip.moves.length).toBeGreaterThan(0);
      expect(r.verdict.distanceToAppetite).toBe(r.flip.flip.moves.length);
    }
  });

  it('REFER only on an open HIGH contradiction: no zero-distance flip', () => {
    const base = perfect();
    const submission: CanonicalSubmission = {
      ...base,
      pricing: {
        quotedPremium: [
          { value: 90_000, provenance: broker },
          { value: 60_000, provenance: record },
        ],
      },
    };
    const r = runEngine({ submission, asOf: AS_OF }, CONFIG);
    expect(r.evaluate.knockout).toBe(false);
    expect(r.evaluate.completeness).toBe(100);
    expect(r.verdict.openHighContradictionIds.length).toBeGreaterThan(0);
    expect(r.verdict.verdict).toBe('REFER');
    expect(r.flip.flip).toBeNull();
    expect(r.flip.reason).toMatch(/contradiction/);
    expect(r.verdict.distanceToAppetite).toBeNull();
  });
});
