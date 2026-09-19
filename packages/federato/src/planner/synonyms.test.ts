import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lookupSynonym, reverseSynonym, synonymTable } from './synonyms';

interface RawField {
  readonly type: string;
  readonly resource?: string;
  readonly fields?: Record<string, RawField>;
}
type RawSchema = Record<string, { readonly fields: Record<string, RawField> }>;

const LIVE: RawSchema = JSON.parse(
  readFileSync(new URL('../../../../docs/federato/live-schema.json', import.meta.url), 'utf8'),
) as RawSchema;

/** Walks a dot-path through nested objects and, where needed, across references. */
function resolve(resource: string, dotPath: string): RawField | null {
  let fields: Record<string, RawField> | undefined = LIVE[resource]?.fields;
  let current: RawField | null = null;
  for (const segment of dotPath.split('.')) {
    if (fields === undefined) return null;
    const next = fields[segment];
    if (next === undefined) return null;
    current = next;
    if (next.type === 'object') fields = next.fields;
    else if (next.type === 'reference' && next.resource !== undefined) fields = LIVE[next.resource]?.fields;
    else fields = undefined;
  }
  return current;
}

describe('synonymTable', () => {
  const table = synonymTable();

  it('has rows for every Federato-backed canonical field the engine reads', () => {
    expect(table.length).toBe(49);
    const paths = new Set(table.map((e) => e.canonicalPath));
    for (const p of [
      'pricing.quotedPremium',
      'pricing.technicalPremium',
      'submissionType',
      'lineOfBusiness',
      'buildings[].tiv',
      'buildings[].yearBuilt',
      'buildings[].constructionType',
      'buildings[].sprinklered',
      'locations[].state',
      'locations[].protectionClass',
      'history[].paidIndemnity',
      'history[].paidExpense',
      'history[].reserves',
      'history[].dateOfLoss',
    ]) {
      expect(paths.has(p), p).toBe(true);
    }
  });

  it('every schemaPath exists in docs/federato/live-schema.json as a scalar leaf', () => {
    for (const entry of table) {
      const field = resolve(entry.resource, entry.schemaPath);
      expect(field, `${entry.resource}.${entry.schemaPath}`).not.toBeNull();
      expect(['object', 'reference']).not.toContain(field!.type);
    }
  });

  it('every resource is one of the twelve in the live schema', () => {
    for (const entry of table) expect(Object.keys(LIVE)).toContain(entry.resource);
    expect(Object.keys(LIVE)).toHaveLength(12);
  });

  it('confidences are in (0, 1] and never below the 0.8 gate', () => {
    for (const entry of table) {
      expect(entry.confidence).toBeGreaterThanOrEqual(0.8);
      expect(entry.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('has no duplicate (resource, schemaPath, canonicalPath) row', () => {
    const keys = table.map((e) => `${e.resource}|${e.schemaPath}|${e.canonicalPath}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only crosses a reference for the headquarters state', () => {
    const crossing = table.filter((e) => {
      const head = e.schemaPath.split('.')[0]!;
      return LIVE[e.resource]!.fields[head]!.type === 'reference';
    });
    expect(crossing.map((e) => e.canonicalPath)).toEqual(['insured.headquartersState']);
  });
});

describe('lookupSynonym', () => {
  it('maps premium fields onto Policy', () => {
    expect(lookupSynonym('pricing.quotedPremium')).toMatchObject({ resource: 'Policy', schemaPath: 'premium', confidence: 1 });
    expect(lookupSynonym('pricing.technicalPremium')).toMatchObject({ resource: 'Policy', schemaPath: 'technical_premium' });
    expect(lookupSynonym('submissionType')).toMatchObject({ resource: 'Policy', schemaPath: 'business_type' });
  });

  it('prefers the higher-confidence row, then table order', () => {
    expect(lookupSynonym('effectiveDate')).toMatchObject({ resource: 'Policy', schemaPath: 'dates.effective' });
    expect(lookupSynonym('status')).toMatchObject({ resource: 'Submission', schemaPath: 'status' });
    expect(lookupSynonym('insured.industry')).toMatchObject({ schemaPath: 'naics_code', confidence: 0.9 });
    expect(lookupSynonym('history[].reserves')).toMatchObject({ schemaPath: 'reserve_indemnity' });
  });

  it('normalizes every element spelling the engine uses', () => {
    const want = { resource: 'Building', schemaPath: 'year_built' };
    expect(lookupSynonym('buildings[].yearBuilt')).toMatchObject(want);
    expect(lookupSynonym('buildings[0].yearBuilt')).toMatchObject(want);
    expect(lookupSynonym('buildings.B1.yearBuilt')).toMatchObject(want);
    expect(lookupSynonym('buildings.yearBuilt')).toMatchObject(want);
    expect(lookupSynonym('  Buildings[].YEARBUILT ')).toMatchObject(want);
    expect(lookupSynonym('locations.L1.state')).toMatchObject({ resource: 'Location', schemaPath: 'state' });
    expect(lookupSynonym('coverage.lines[2].deductible')).toMatchObject({ resource: 'Coverage', schemaPath: 'deductible' });
    expect(lookupSynonym('history.C1.reserves')).toMatchObject({ resource: 'Claim' });
  });

  it('returns null for derived, swept and unknown paths', () => {
    expect(lookupSynonym('rollup.totalTiv')).toBeNull();
    expect(lookupSynonym('hazards.candle')).toBeNull();
    expect(lookupSynonym('locations[].floodZone')).toBeNull();
    expect(lookupSynonym('nonsense.path')).toBeNull();
    expect(lookupSynonym('')).toBeNull();
  });
});

describe('reverseSynonym', () => {
  it('maps raw schema paths back to canonical paths', () => {
    expect(reverseSynonym('Building', 'tiv')?.canonicalPath).toBe('buildings[].tiv');
    expect(reverseSynonym('Policy', 'dates.effective')?.canonicalPath).toBe('effectiveDate');
    expect(reverseSynonym('Policy', 'Line_Of_Business')?.canonicalPath).toBe('lineOfBusiness');
    expect(reverseSynonym('Location', 'state')?.canonicalPath).toBe('locations[].state');
    expect(reverseSynonym('Insured', 'hq.state')?.canonicalPath).toBe('insured.headquartersState');
    expect(reverseSynonym('Claim', 'reserve_expense')?.canonicalPath).toBe('history[].reserves');
  });

  it('is resource-scoped and null when unmapped', () => {
    expect(reverseSynonym('Submission', 'premium')).toBeNull();
    expect(reverseSynonym('Building', 'business_interruption_value')).toBeNull();
    expect(reverseSynonym('Broker', 'name')?.canonicalPath).toBe('insured.brokerName');
    expect(reverseSynonym('Contact', 'name')?.canonicalPath).toBe('insured.contactName');
  });
});
