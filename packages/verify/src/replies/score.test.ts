/**
 * V06 tests — the 30 broker replies and the extraction scorer (PRD §12).
 */
import { describe, expect, it } from 'vitest';
import type { ExtractReplyOutput, ExtractReplyValue } from '@retrofit/contracts';
import type { BrokerReplyFixture } from '../types.js';
import {
  BROKER_REPLIES,
  EXTRACTION_GATE,
  extractionInputFor,
  replyFieldSpec,
  requestedFieldsFor,
  runExtractionCheck,
  scoreExtraction,
  scoreFixture,
  valuesMatch,
} from './index.js';

const allFields = BROKER_REPLIES.flatMap((f) => Object.entries(f.expected).map(([path, value]) => ({ f, path, value })));

/** An extractor that returns every expected value, nulls omitted, at `confidence`. */
function oracleOutput(fixture: BrokerReplyFixture, confidence = 0.95): ExtractReplyOutput {
  const values: ExtractReplyValue[] = [];
  const notFound: string[] = [];
  for (const [canonicalPath, value] of Object.entries(fixture.expected)) {
    if (value === null) notFound.push(canonicalPath);
    else values.push({ canonicalPath, value, confidence, quote: fixture.text.slice(0, 20) });
  }
  return { values, notFound };
}

function outputs(make: (f: BrokerReplyFixture) => ExtractReplyOutput): Record<string, ExtractReplyOutput> {
  return Object.fromEntries(BROKER_REPLIES.map((f) => [f.id, make(f)]));
}

describe('broker reply fixtures', () => {
  it('has exactly 30 replies, six of each style, with unique ids', () => {
    expect(BROKER_REPLIES).toHaveLength(30);
    expect(new Set(BROKER_REPLIES.map((f) => f.id)).size).toBe(30);
    const counts: Record<string, number> = {};
    for (const f of BROKER_REPLIES) counts[f.style] = (counts[f.style] ?? 0) + 1;
    expect(counts).toEqual({ clean: 6, partial: 6, vague: 6, self_contradicting: 6, loss_run: 6 });
  });

  it('expects 51 fields: 30 with a value and 21 that must not clear the gate', () => {
    expect(allFields).toHaveLength(51);
    expect(allFields.filter((x) => x.value === null)).toHaveLength(21);
  });

  it('has a field spec for every expected path, with options covering every expected string', () => {
    for (const { f, path, value } of allFields) {
      const spec = replyFieldSpec(path);
      expect(spec.canonicalPath).toBe(path);
      if (typeof value === 'string' && spec.options) expect(spec.options, f.id).toContain(value);
    }
    expect(() => replyFieldSpec('buildings.B1.colour')).toThrow(/no field spec/);
    expect(requestedFieldsFor(BROKER_REPLIES[5] as BrokerReplyFixture).map((s) => s.type)).toEqual([
      'money',
      'string',
      'year',
      'boolean',
    ]);
  });

  it('states every expected year verbatim, so the extractor can quote it (A06 year-in-quote rule)', () => {
    for (const { f, path, value } of allFields) {
      if (path.endsWith('.yearBuilt') && value !== null) expect(f.text, f.id).toContain(String(value));
    }
  });

  it('keeps clean replies free of nulls and vague replies all-null', () => {
    for (const f of BROKER_REPLIES) {
      const values = Object.values(f.expected);
      if (f.style === 'clean') expect(values, f.id).not.toContain(null);
      if (f.style === 'vague') expect(values.every((v) => v === null), f.id).toBe(true);
    }
  });

  it('records a stated zero loss as 0, never as missing (G-1)', () => {
    const zero = BROKER_REPLIES.find((f) => f.id === 'lossrun-02');
    expect(zero?.expected['history.fiveYearLoss']).toBe(0);
  });

  it('builds the extract-reply input from the text and the expected keys', () => {
    const f = BROKER_REPLIES[0] as BrokerReplyFixture;
    const input = extractionInputFor(f);
    expect(input.sourceText).toBe(f.text);
    expect(input.requestedFields.map((s) => s.canonicalPath)).toEqual(['buildings.B2.yearBuilt', 'buildings.B2.tiv']);
  });
});

describe('valuesMatch', () => {
  it('parses money per G-4, percents per G-6, construction per G-8', () => {
    expect(valuesMatch(2500000, '$2.5M')).toBe(true);
    expect(valuesMatch(150000000, '$150M')).toBe(true);
    expect(valuesMatch(50000, '$50K')).toBe(true);
    expect(valuesMatch(4250000, '$4,250,000')).toBe(true);
    expect(valuesMatch(3100000, '3.1 million')).toBe(true);
    expect(valuesMatch(0.5, '50%')).toBe(true);
    expect(valuesMatch(50, '50%')).toBe(false);
    expect(valuesMatch('masonry_non_combustible', 'Masonry Non-Combustible')).toBe(true);
    expect(valuesMatch('OH', 'oh')).toBe(true);
  });

  it('rejects near misses and type mismatches', () => {
    expect(valuesMatch(1978, 1979)).toBe(false);
    expect(valuesMatch(142300, 98000)).toBe(false);
    expect(valuesMatch(true, 'yes')).toBe(true);
    expect(valuesMatch(false, 'no')).toBe(true);
    expect(valuesMatch(true, 'maybe')).toBe(false);
    expect(valuesMatch('steel', 7)).toBe(false);
    expect(valuesMatch(0, null)).toBe(false);
    expect(valuesMatch(null, null)).toBe(true);
  });
});

describe('scoreExtraction', () => {
  it('scores a perfect extractor at accuracy 1 with nothing wrong through the gate', () => {
    const score = scoreExtraction(BROKER_REPLIES, outputs((f) => oracleOutput(f)));
    expect(score).toEqual({ fixtures: 30, fieldsExpected: 51, fieldsCorrect: 51, fieldAccuracy: 1, wrongThroughGate: 0 });
  });

  it('scores an extractor that answers nothing: only the 21 null fields are right', () => {
    const score = scoreExtraction(BROKER_REPLIES, {});
    expect(score.fieldsCorrect).toBe(21);
    expect(score.fieldAccuracy).toBeCloseTo(21 / 51, 12);
    expect(score.wrongThroughGate).toBe(0);
  });

  it('counts every overconfident guess on a null field as wrong through the gate', () => {
    const guessing = outputs((f) => ({
      values: Object.entries(f.expected).map(([canonicalPath, value]) => ({
        canonicalPath,
        value: value ?? 1234,
        confidence: 0.9,
        quote: 'x',
      })),
      notFound: [],
    }));
    const score = scoreExtraction(BROKER_REPLIES, guessing);
    expect(score.fieldsCorrect).toBe(30);
    expect(score.wrongThroughGate).toBe(21);
    expect(score.fieldAccuracy).toBeCloseTo(30 / 51, 12);
  });

  it('does not count a wrong value held below the gate, and treats exactly 0.8 as through', () => {
    const f = BROKER_REPLIES.find((x) => x.id === 'contradict-01') as BrokerReplyFixture;
    const at = (confidence: number) =>
      scoreFixture(f, { values: [{ canonicalPath: 'buildings.B2.yearBuilt', value: 1985, confidence, quote: 'q' }], notFound: [] })[0];
    expect(at(0.5)?.outcome).toBe('correct');
    expect(at(0.79)?.throughGate).toBe(false);
    expect(at(EXTRACTION_GATE)?.outcome).toBe('spurious');

    const clean = BROKER_REPLIES.find((x) => x.id === 'clean-01') as BrokerReplyFixture;
    const wrongLow = scoreExtraction([clean], {
      'clean-01': { values: [{ canonicalPath: 'buildings.B2.yearBuilt', value: 1987, confidence: 0.6, quote: 'q' }], notFound: [] },
    });
    expect(wrongLow).toEqual({ fixtures: 1, fieldsExpected: 2, fieldsCorrect: 0, fieldAccuracy: 0, wrongThroughGate: 0 });
  });

  it('judges the highest-confidence value when a path comes back twice', () => {
    const f = BROKER_REPLIES.find((x) => x.id === 'contradict-06') as BrokerReplyFixture;
    const [field] = scoreFixture(f, {
      values: [
        { canonicalPath: 'buildings.B2.yearBuilt', value: 1978, confidence: 0.4, quote: 'q' },
        { canonicalPath: 'buildings.B2.yearBuilt', value: 1992, confidence: 0.5, quote: 'q' },
        { canonicalPath: 'pricing.quotedPremium', value: 1, confidence: 1, quote: 'q' },
      ],
      notFound: [],
    });
    expect(field).toMatchObject({ actual: 1992, confidence: 0.5, outcome: 'correct', throughGate: false });
  });
});

describe('runExtractionCheck', () => {
  it('runs every fixture, splits by style, and records an extractor failure as missed', async () => {
    const byText = new Map(BROKER_REPLIES.map((f) => [f.text, f]));
    const report = await runExtractionCheck(async (input) => {
      const f = byText.get(input.sourceText ?? '') as BrokerReplyFixture;
      if (f.id === 'lossrun-06') throw new Error('quota');
      return oracleOutput(f);
    });
    expect(report.errors).toEqual([{ fixtureId: 'lossrun-06', message: 'quota' }]);
    expect(report.fields).toHaveLength(51);
    expect(report.score.fieldsCorrect).toBe(49);
    expect(report.score.wrongThroughGate).toBe(0);
    expect(report.byStyle).toEqual([
      { style: 'clean', fieldsExpected: 15, fieldsCorrect: 15, wrongThroughGate: 0 },
      { style: 'partial', fieldsExpected: 15, fieldsCorrect: 15, wrongThroughGate: 0 },
      { style: 'vague', fieldsExpected: 7, fieldsCorrect: 7, wrongThroughGate: 0 },
      { style: 'self_contradicting', fieldsExpected: 7, fieldsCorrect: 7, wrongThroughGate: 0 },
      { style: 'loss_run', fieldsExpected: 7, fieldsCorrect: 5, wrongThroughGate: 0 },
    ]);
  });
});
