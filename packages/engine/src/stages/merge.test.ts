import { describe, expect, it } from 'vitest';
import type {
  CanonicalSubmission,
  ExternalValue,
  Field,
  Observation,
  Provenance,
  Sourced,
} from '../types.js';
import { merge } from './merge.js';

const broker: Provenance = { source: 'self_reported', sourceDetail: 'Policy.submission' };

function field<T>(value: T, provenance: Provenance): Sourced<T> {
  return [{ value, provenance }];
}

function base(): CanonicalSubmission {
  return {
    id: 'SUB-1',
    lineOfBusiness: 'commercial_property',
    submissionType: field('new_business', broker),
    insured: { name: field('Acme Holdings', broker) },
    locations: [{ externalId: 'L1', state: field('OH', broker) }],
    buildings: [
      { externalId: 'B1', tiv: field(1_000_000, broker), yearBuilt: field(1988, broker) },
      { externalId: 'B2', tiv: field(2_000_000, broker) },
    ],
    hazards: { present: {} },
    exposure: {},
    coverage: { lines: [{ code: 'PROP', limit: field(5_000_000, broker) }] },
    history: [{ externalId: 'C1', paidIndemnity: field(1000, broker) }],
    pricing: { quotedPremium: field(80_000, broker) },
  };
}

function observation(over: Partial<Observation> & Pick<Observation, 'id' | 'label'>): Observation {
  return {
    category: 'other',
    bearingDeg: 0,
    distanceBand: 'mid',
    confidence: 0.7,
    frameIndex: 0,
    ...over,
  } as Observation;
}

function slot(submission: CanonicalSubmission, path: string): readonly Field<unknown>[] {
  const seg = path.split('.');
  let node: unknown = submission;
  for (const key of seg) {
    if (Array.isArray(node)) {
      node = node.find(
        (e: Record<string, unknown>) => e.externalId === key || e.code === key,
      ) as unknown;
    } else {
      node = (node as Record<string, unknown>)[key];
    }
  }
  return (node ?? []) as readonly Field<unknown>[];
}

const sources = (fields: readonly Field<unknown>[]): string[] =>
  fields.map((f) => f.provenance.source);

describe('merge — provenance precedence', () => {
  it('appends beside the broker value, never overwriting it', () => {
    const enrichment: ExternalValue[] = [
      {
        canonicalPath: 'buildings.B1.yearBuilt',
        value: 1992,
        provenance: { source: 'enrichment', sourceDetail: 'assessor' },
      },
    ];
    const out = merge(base(), enrichment, [], []);
    const fields = slot(out, 'buildings.B1.yearBuilt');

    expect(fields).toHaveLength(2);
    expect(fields[0]!.value).toBe(1988);
    expect(fields[0]!.provenance.source).toBe('self_reported');
    expect(fields[1]!.value).toBe(1992);
    expect(fields[1]!.provenance.source).toBe('enrichment');
  });

  it('orders the appends self_reported, enrichment, sweep, answer', () => {
    const enrichment: ExternalValue[] = [
      {
        canonicalPath: 'insured.name',
        value: 'Acme Holdings LLC',
        provenance: { source: 'enrichment' },
      },
    ];
    const answers: ExternalValue[] = [
      { canonicalPath: 'insured.name', value: 'Acme Holding Co', provenance: { source: 'answer' } },
    ];
    const out = merge(base(), enrichment, [], answers);

    expect(sources(slot(out, 'insured.name'))).toEqual(['self_reported', 'enrichment', 'answer']);
  });

  it('never mutates the submission it was given', () => {
    const input = base();
    merge(
      input,
      [{ canonicalPath: 'buildings.B1.tiv', value: 9, provenance: { source: 'enrichment' } }],
      [observation({ id: 'O1', label: 'candle' })],
      [],
    );

    expect(slot(input, 'buildings.B1.tiv')).toHaveLength(1);
    expect(input.hazards.present).toEqual({});
  });

  it('returns the same object when there is nothing to merge', () => {
    const input = base();
    expect(merge(input, [], [], [])).toBe(input);
  });
});

describe('merge — missing and unresolvable values', () => {
  it('drops null, undefined and NaN instead of appending them (G-1)', () => {
    const enrichment: ExternalValue[] = [
      { canonicalPath: 'buildings.B1.tiv', value: null, provenance: { source: 'enrichment' } },
      { canonicalPath: 'buildings.B2.tiv', value: undefined, provenance: { source: 'enrichment' } },
      { canonicalPath: 'pricing.quotedPremium', value: NaN, provenance: { source: 'enrichment' } },
    ];
    const out = merge(base(), enrichment, [], []);

    expect(slot(out, 'buildings.B1.tiv')).toHaveLength(1);
    expect(slot(out, 'buildings.B2.tiv')).toHaveLength(1);
    expect(slot(out, 'pricing.quotedPremium')).toHaveLength(1);
  });

  it('drops values addressed to a path the submission does not have', () => {
    const out = merge(
      base(),
      [
        { canonicalPath: 'buildings.B9.tiv', value: 5, provenance: { source: 'enrichment' } },
        { canonicalPath: 'nonsense.path', value: 5, provenance: { source: 'enrichment' } },
        { canonicalPath: 'insured.notAField', value: 5, provenance: { source: 'enrichment' } },
      ],
      [],
      [],
    );

    expect(out.buildings).toHaveLength(2);
    expect(Object.keys(out.insured)).toEqual(['name']);
  });

  it('writes list, hazard-shorthand and coverage-line paths', () => {
    const out = merge(
      base(),
      [
        { canonicalPath: 'locations.L1.floodZone', value: 'AE', provenance: { source: 'enrichment' } },
        { canonicalPath: 'hazards.candle', value: true, provenance: { source: 'answer' } },
        {
          canonicalPath: 'coverage.lines.PROP.deductible',
          value: 25_000,
          provenance: { source: 'answer' },
        },
        { canonicalPath: 'history.C1.reserves', value: 4_000, provenance: { source: 'answer' } },
      ],
      [],
      [],
    );

    expect(slot(out, 'locations.L1.floodZone')[0]!.value).toBe('AE');
    expect(slot(out, 'hazards.present.candle')[0]!.value).toBe(true);
    expect(slot(out, 'coverage.lines.PROP.deductible')[0]!.value).toBe(25_000);
    expect(slot(out, 'history.C1.reserves')[0]!.value).toBe(4_000);
  });
});

describe('merge — sweep observations', () => {
  it('sets hazard presence from the highest-confidence sighting', () => {
    const out = merge(
      base(),
      [],
      [
        observation({ id: 'O1', label: 'portable_heater', confidence: 0.4 }),
        observation({ id: 'O2', label: 'portable_heater', confidence: 0.9 }),
      ],
      [],
    );
    const fields = slot(out, 'hazards.present.portableHeater');

    expect(fields).toHaveLength(1);
    expect(fields[0]!.value).toBe(true);
    expect(fields[0]!.provenance).toEqual({
      source: 'sweep',
      sourceDetail: 'observation:O2',
      confidence: 0.9,
    });
  });

  it('counts detectors, sprinkler heads and high-value contents', () => {
    const out = merge(
      base(),
      [],
      [
        observation({ id: 'O1', label: 'smoke_detector', confidence: 0.8 }),
        observation({ id: 'O2', label: 'smoke_detector', confidence: 0.6 }),
        observation({ id: 'O3', label: 'sprinkler_head', confidence: 0.75 }),
        observation({ id: 'O4', label: 'laptop', confidence: 0.9 }),
        observation({ id: 'O5', label: 'tv', confidence: 0.5 }),
        observation({ id: 'O6', label: 'jewelry', confidence: 0.55 }),
        observation({ id: 'O7', label: 'bike', confidence: 0.95 }),
      ],
      [],
    );

    expect(slot(out, 'hazards.smokeDetectorCount')[0]!.value).toBe(2);
    expect(slot(out, 'hazards.smokeDetectorCount')[0]!.provenance.confidence).toBe(0.8);
    expect(slot(out, 'hazards.sprinklerHeadCount')[0]!.value).toBe(1);
    expect(slot(out, 'hazards.present.highValueContents')[0]!.value).toBe(3);
    // `bike` is in the vocabulary but is not a hazard presence key.
    expect(Object.keys(out.hazards.present)).toEqual(['highValueContents']);
  });

  it('records the ceiling only when an observation actually saw it', () => {
    const withoutCeiling = merge(base(), [], [observation({ id: 'O1', label: 'stove' })], []);
    expect(withoutCeiling.hazards.ceilingObserved).toBeUndefined();

    const withCeiling = merge(
      base(),
      [],
      [observation({ id: 'O1', label: 'stove', ceilingVisible: true, confidence: 0.65 })],
      [],
    );
    expect(slot(withCeiling, 'hazards.ceilingObserved')[0]!.value).toBe(true);
    expect(slot(withCeiling, 'hazards.ceilingObserved')[0]!.provenance.confidence).toBe(0.65);
  });

  it('places sweep values before answers in the same slot', () => {
    const answers: ExternalValue[] = [
      { canonicalPath: 'hazards.present.candle', value: false, provenance: { source: 'answer' } },
    ];
    const out = merge(base(), [], [observation({ id: 'O1', label: 'candle' })], answers);

    expect(sources(slot(out, 'hazards.present.candle'))).toEqual(['sweep', 'answer']);
  });
});
