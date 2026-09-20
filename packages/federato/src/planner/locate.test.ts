import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CommercialRatingTable,
  Rulebook,
  TenantRatingTable,
  VectorSpec,
} from '@retrofit/engine';
import { MINI_SCHEMA } from '../../fixtures/mini-snapshot';
import type {
  FederatoResource,
  GraphPath,
  NeededField,
  ResourceEdge,
  ResourceGraph,
  SchemaAssistFn,
  SynonymEntry,
} from '../types';

/*
 * F07 (synonym table + graph search) is a sibling unit. These tests pin the
 * inputs F08 depends on so they exercise F08's own logic: the gate, the
 * fallbacks, the routing preference and the visible-unmapped behaviour.
 */
const SYNONYMS = new Map<string, SynonymEntry>();

vi.mock('./synonyms', () => ({
  lookupSynonym: (p: string) => SYNONYMS.get(p) ?? null,
  synonymTable: () => [...SYNONYMS.values()],
  reverseSynonym: () => null,
}));

vi.mock('./graph', () => ({
  pathsFrom: (graph: ResourceGraph, from: FederatoResource, maxHops = 4): GraphPath[] => {
    const out: GraphPath[] = [];
    const walk = (at: FederatoResource, edges: ResourceEdge[], seen: Set<FederatoResource>) => {
      if (edges.length > 0) {
        out.push({
          from,
          to: at,
          edges: [...edges],
          dotPath: edges.map((e) => e.field).join('.'),
          crossesArray: edges.some((e) => e.cardinality === 'many'),
          hops: edges.length,
        });
      }
      if (edges.length >= maxHops) return;
      for (const e of graph.edges.filter((x) => x.from === at)) {
        if (seen.has(e.to)) continue;
        walk(e.to, [...edges, e], new Set([...seen, e.to]));
      }
    };
    walk(from, [], new Set([from]));
    return out.sort((a, b) => a.hops - b.hops || a.dotPath.localeCompare(b.dotPath));
  },
}));

const { collectNeededFields } = await import('./collect');
const { locateFields } = await import('./locate');

const GRAPH: ResourceGraph = {
  resources: MINI_SCHEMA.resources.map((r) => r.name as FederatoResource),
  edges: MINI_SCHEMA.resources.flatMap((r) =>
    r.fields
      .filter((f) => f.reference !== undefined)
      .map((f) => ({
        from: r.name as FederatoResource,
        to: f.reference as FederatoResource,
        field: f.path,
        cardinality: f.isArray === true ? ('many' as const) : ('one' as const),
      })),
  ),
};

const engineDir = fileURLToPath(new URL('../../../engine/', import.meta.url));
const json = <T>(rel: string): T => JSON.parse(readFileSync(`${engineDir}${rel}`, 'utf8')) as T;

const COMMERCIAL_SPEC = json<VectorSpec>('vectors/commercial.json');
const COMMERCIAL_RULES = json<Rulebook>('rules/commercial.json');
const EXTENSIONS = json<Rulebook>('rules/extensions.json');
const TENANT_SPEC = json<VectorSpec>('vectors/tenant.json');
const TENANT_RULES = json<Rulebook>('rules/tenant.json');
const TENANT_RATING = json<TenantRatingTable>('rating/tenant.json');

const COMMERCIAL_RATING: CommercialRatingTable = {
  lineOfBusiness: 'commercial_property',
  version: 'test',
  baseRate: 0.1,
  construction: { 'Fire Resistive': 0.8 },
  age: [{ key: 'any', upTo: null, factor: 1 }],
  protectionClass: [{ key: 'any', upTo: null, factor: 1 }],
  sprinkler: { sprinklered: 0.9, unsprinklered: 1.1 },
  lossHistory: [{ key: 'any', upTo: null, factor: 1 }],
  credibilityK: 5,
};

const need = (canonicalPath: string, ruleId = 'R-1'): NeededField => ({
  canonicalPath,
  componentKey: null,
  factor: null,
  required: true,
  requiredBy: [{ ruleId, factor: null, canonicalPath, why: `${ruleId} needs ${canonicalPath}` }],
});

const syn = (canonicalPath: string, resource: FederatoResource, schemaPath: string, confidence = 1) =>
  SYNONYMS.set(canonicalPath, { canonicalPath, resource, schemaPath, confidence });

beforeEach(() => SYNONYMS.clear());

/* -------------------------------------------------------------------------- */

describe('collectNeededFields — commercial', () => {
  const needed = collectNeededFields({
    spec: COMMERCIAL_SPEC,
    rulebook: COMMERCIAL_RULES,
    extensions: EXTENSIONS,
    ratingTable: COMMERCIAL_RATING,
  });
  const byPath = new Map(needed.map((n) => [n.canonicalPath, n]));

  it('expands rollup reads into the base canonical fields the schema can hold', () => {
    expect(needed.map((n) => n.canonicalPath)).toEqual([
      'buildings[].constructionType',
      'buildings[].protectionClass',
      'buildings[].sprinklered',
      'buildings[].tiv',
      'buildings[].yearBuilt',
      'history[].dateOfLoss',
      'history[].paidExpense',
      'history[].paidIndemnity',
      'history[].reserves',
      'lineOfBusiness',
      // Needed by the flood extension rules and the flood rating load. Federato
      // carries no flood field, so it can only ever arrive from enrichment —
      // the planner says so rather than dropping the dependency.
      'locations[].floodZone',
      'locations[].protectionClass',
      'locations[].state',
      'pricing.quotedPremium',
      'receivedDate',
      'submissionType',
    ]);
    expect(needed.some((n) => n.canonicalPath.startsWith('rollup.'))).toBe(false);
  });

  it('carries every rule that needs a field, with the path the rule reads', () => {
    const tiv = byPath.get('buildings[].tiv');
    const ids = new Set(tiv?.requiredBy.map((r) => r.ruleId));
    for (const id of ['AG-TIV-T', 'AG-TIV-NA', 'AG-AGE-NA', 'AG-CON-NA', 'AG-STATE-T', 'X-SPRINKLER-MAJORITY', 'rating:baseRate', 'rating:construction']) {
      expect(ids.has(id)).toBe(true);
    }
    expect(tiv?.requiredBy.find((r) => r.ruleId === 'AG-TIV-NA')?.canonicalPath).toBe('rollup.totalTiv');
    // TIV feeds several components and factors, so neither is singular.
    expect(tiv?.componentKey).toBeNull();
    expect(tiv?.factor).toBeNull();
    expect(tiv?.required).toBe(true);

    // AG-AGE-REFER reads rollup.oldestYearBuilt directly (not a component).
    const year = byPath.get('buildings[].yearBuilt');
    expect(year?.requiredBy.some((r) => r.ruleId === 'AG-AGE-REFER' && r.canonicalPath === 'rollup.oldestYearBuilt')).toBe(true);
    expect(year?.factor).toBe('building_age');
  });

  it('keeps single component attribution and the required flag from the spec', () => {
    const prem = byPath.get('pricing.quotedPremium');
    expect(prem?.componentKey).toBe('quotedPremium');
    expect(prem?.factor).toBe('total_premium');
    expect(prem?.required).toBe(true);
    // Sprinkler is extension-only in the spec (required: false).
    expect(byPath.get('buildings[].sprinklered')?.required).toBe(false);
    expect(byPath.get('buildings[].sprinklered')?.componentKey).toBe('pctTivSprinklered');
    // Loss window inputs come from the rules AND the rating lossHistory column.
    const reserves = byPath.get('history[].reserves');
    expect(reserves?.requiredBy.map((r) => r.ruleId)).toContain('AG-LOSS-NA');
    expect(reserves?.requiredBy.map((r) => r.ruleId)).toContain('rating:lossHistory');
  });

  it('is deterministic and never duplicates a rule need', () => {
    const again = collectNeededFields({
      spec: COMMERCIAL_SPEC,
      rulebook: COMMERCIAL_RULES,
      extensions: EXTENSIONS,
      ratingTable: COMMERCIAL_RATING,
    });
    expect(again).toEqual(needed);
    for (const n of needed) {
      const keys = n.requiredBy.map((r) => `${r.ruleId}|${r.canonicalPath}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('ignores a rating table for the other line', () => {
    const withTenantTable = collectNeededFields({
      spec: COMMERCIAL_SPEC,
      rulebook: COMMERCIAL_RULES,
      ratingTable: TENANT_RATING,
    });
    expect(withTenantTable.flatMap((n) => n.requiredBy).some((r) => r.ruleId.startsWith('rating:'))).toBe(false);
  });
});

describe('collectNeededFields — tenant', () => {
  const needed = collectNeededFields({ spec: TENANT_SPEC, rulebook: TENANT_RULES, ratingTable: TENANT_RATING });
  const byPath = new Map(needed.map((n) => [n.canonicalPath, n]));

  it('normalizes indexed sources and maps rating columns through components', () => {
    expect(byPath.has('buildings[0].yearBuilt')).toBe(false);
    const year = byPath.get('buildings[].yearBuilt');
    expect(year?.componentKey).toBe('buildingYearBuilt');
    expect(year?.requiredBy.map((r) => r.ruleId)).toContain('rating:buildingAge');
    expect(byPath.get('exposure.contentsLimit')?.requiredBy.map((r) => r.ruleId)).toContain('rating:contents');
    expect(byPath.get('hazards.portableHeater')?.requiredBy.map((r) => r.ruleId)).toContain('T-HZ-HEATER');
    expect(needed).toHaveLength(TENANT_SPEC.components.length);
  });
});

/* -------------------------------------------------------------------------- */

describe('locateFields', () => {
  const base = { schema: MINI_SCHEMA, graph: GRAPH };

  it('resolves a synonym to a Policy-rooted path through the array hops', async () => {
    syn('buildings[].tiv', 'Building', 'tiv', 0.95);
    const r = await locateFields({ ...base, needed: [need('buildings[].tiv')] });
    expect(r.unmapped).toEqual([]);
    expect(r.located).toHaveLength(1);
    const f = r.located[0];
    expect(f?.method).toBe('synonym');
    expect(f?.rootResource).toBe('Policy');
    expect(f?.schemaPath).toBe('exposure_units.location.buildings.tiv');
    expect(f?.referenceHops).toEqual(['exposure_units', 'location', 'buildings']);
    expect(f?.crossesArray).toBe(true);
    expect(f?.confidence).toBe(0.95);
    expect(r.fieldMap.entries).toEqual([
      expect.objectContaining({ rawPath: 'Building.tiv', canonicalPath: 'buildings[].tiv', method: 'synonym', confidence: 0.95 }),
    ]);
    expect(r.assistUsed).toBe(false);
  });

  it('prefers the array route for per-item paths and the direct route otherwise', async () => {
    syn('locations[].state', 'Location', 'state');
    syn('insured.headquartersState', 'Insured', 'hq.state');
    syn('pricing.quotedPremium', 'Policy', 'premium');
    const r = await locateFields({
      ...base,
      needed: [need('locations[].state'), need('insured.headquartersState'), need('pricing.quotedPremium')],
    });
    const by = new Map(r.located.map((l) => [l.canonicalPath, l]));
    expect(by.get('locations[].state')?.schemaPath).toBe('exposure_units.location.state');
    expect(by.get('insured.headquartersState')?.schemaPath).toBe('insured.hq.state');
    expect(by.get('insured.headquartersState')?.referenceHops).toEqual(['insured', 'hq']);
    expect(by.get('insured.headquartersState')?.crossesArray).toBe(false);
    expect(by.get('pricing.quotedPremium')?.schemaPath).toBe('premium');
    expect(by.get('pricing.quotedPremium')?.referenceHops).toEqual([]);
  });

  it('walks dotted flattened field names (producer.broker)', async () => {
    syn('insured.brokerName', 'Policy', 'producer.broker.name');
    const r = await locateFields({ ...base, needed: [need('insured.brokerName')] });
    expect(r.located[0]?.schemaPath).toBe('producer.broker.name');
    expect(r.located[0]?.referenceHops).toEqual(['producer.broker']);
    expect(r.fieldMap.entries[0]?.rawPath).toBe('Broker.name');
  });

  it('falls back to a graph search on normalized names at 0.85', async () => {
    const r = await locateFields({ ...base, needed: [need('buildings[].roofYear')] });
    expect(r.located[0]).toMatchObject({
      method: 'graph',
      confidence: 0.85,
      rootResource: 'Policy',
      schemaPath: 'exposure_units.location.buildings.roof_year',
    });
  });

  it('falls back to the graph when a synonym path is not in the schema', async () => {
    syn('buildings[].yearBuilt', 'Building', 'built_in_year');
    const r = await locateFields({ ...base, needed: [need('buildings[].yearBuilt')] });
    expect(r.located[0]?.method).toBe('graph');
    expect(r.located[0]?.schemaPath).toBe('exposure_units.location.buildings.year_built');
  });

  it('keeps a below-gate synonym visibly unmapped with its best guess', async () => {
    syn('exposure.squareFeet', 'Building', 'square_footage', 0.79);
    const r = await locateFields({ ...base, needed: [need('exposure.squareFeet')] });
    expect(r.located).toEqual([]);
    expect(r.unmapped).toHaveLength(1);
    expect(r.unmapped[0]).toMatchObject({
      canonicalPath: 'exposure.squareFeet',
      method: 'unmapped',
      rootResource: null,
      schemaPath: null,
      confidence: 0,
    });
    expect(r.fieldMap.unmapped).toEqual([
      expect.objectContaining({
        rawPath: 'Building.square_footage',
        bestGuess: { canonicalPath: 'exposure.squareFeet', confidence: 0.79 },
      }),
    ]);
  });

  it('accepts a synonym at exactly the 0.8 gate', async () => {
    syn('exposure.squareFeet', 'Building', 'square_footage', 0.8);
    const r = await locateFields({ ...base, needed: [need('exposure.squareFeet')] });
    expect(r.located[0]?.confidence).toBe(0.8);
    expect(r.unmapped).toEqual([]);
  });

  it('never calls the assist when everything resolves, and is deterministic without it', async () => {
    const assist = vi.fn<SchemaAssistFn>(async () => []);
    syn('pricing.quotedPremium', 'Policy', 'premium');
    const r = await locateFields({ ...base, needed: [need('pricing.quotedPremium')], schemaAssist: assist });
    expect(assist).not.toHaveBeenCalled();
    expect(r.assistUsed).toBe(false);

    const noAssist = await locateFields({ ...base, needed: [need('insured.foundedYear')] });
    expect(noAssist.unmapped[0]?.why).toContain('Schema assist not configured');
    expect(noAssist.fieldMap.unmapped[0]?.rawPath).toBe('insured.foundedYear');
  });

  it('sends only unresolved names to the assist and applies the >= 0.8 gate', async () => {
    syn('buildings[].tiv', 'Building', 'tiv');
    const assist = vi.fn<SchemaAssistFn>(async () => [
      { rawPath: 'Insured.year_founded', canonicalPath: 'insured.foundedYear', confidence: 0.92, reason: 'founding year' },
      { rawPath: 'Insured.entity_type', canonicalPath: 'insured.legalForm', confidence: 0.75, reason: 'maybe' },
      { rawPath: 'Nope.field', canonicalPath: 'insured.madeUp', confidence: 0.99, reason: 'invented' },
      { rawPath: 'Building.tiv', canonicalPath: 'buildings[].tiv', confidence: 0.99, reason: 'already mapped' },
    ]);
    const r = await locateFields({
      ...base,
      needed: [need('buildings[].tiv'), need('insured.foundedYear'), need('insured.legalForm'), need('insured.madeUp')],
      schemaAssist: assist,
    });

    expect(assist).toHaveBeenCalledTimes(1);
    const req = assist.mock.calls[0]?.[0];
    expect(req?.canonicalFields.map((c) => c.canonicalPath)).toEqual([
      'insured.foundedYear',
      'insured.legalForm',
      'insured.madeUp',
    ]);
    // Already-claimed raw paths are not offered again.
    expect(req?.unmappedKeys.some((k) => k.rawPath === 'Building.tiv')).toBe(false);
    expect(req?.unmappedKeys.some((k) => k.rawPath === 'Insured.year_founded')).toBe(true);
    expect(req?.unmappedKeys.some((k) => k.rawPath === 'Policy.claims')).toBe(false);

    expect(r.assistUsed).toBe(true);
    const llm = r.located.find((l) => l.canonicalPath === 'insured.foundedYear');
    expect(llm).toMatchObject({
      method: 'llm',
      confidence: 0.92,
      rootResource: 'Policy',
      schemaPath: 'insured.year_founded',
    });
    expect(r.located.find((l) => l.canonicalPath === 'buildings[].tiv')?.method).toBe('synonym');

    expect(r.unmapped.map((u) => u.canonicalPath)).toEqual(['insured.legalForm', 'insured.madeUp']);
    const legal = r.fieldMap.unmapped.find((u) => u.bestGuess?.canonicalPath === 'insured.legalForm');
    expect(legal?.rawPath).toBe('Insured.entity_type');
    expect(legal?.bestGuess?.confidence).toBe(0.75);
    expect(r.unmapped.find((u) => u.canonicalPath === 'insured.madeUp')?.why).toContain('not an offered schema field');
  });

  it('takes the highest-confidence assist mapping for a name', async () => {
    const assist: SchemaAssistFn = async () => [
      { rawPath: 'Insured.annual_revenue', canonicalPath: 'insured.sales', confidence: 0.81, reason: 'a' },
      { rawPath: 'Insured.employee_count', canonicalPath: 'insured.sales', confidence: 0.9, reason: 'b' },
    ];
    const r = await locateFields({ ...base, needed: [need('insured.sales')], schemaAssist: assist });
    expect(r.fieldMap.entries[0]).toMatchObject({ rawPath: 'Insured.employee_count', confidence: 0.9, method: 'llm' });
  });

  it('survives an assist failure and keeps the names visible', async () => {
    const assist: SchemaAssistFn = async () => {
      throw new Error('quota');
    };
    const r = await locateFields({ ...base, needed: [need('insured.foundedYear')], schemaAssist: assist });
    expect(r.assistUsed).toBe(false);
    expect(r.located).toEqual([]);
    expect(r.unmapped[0]?.why).toContain('Schema assist failed: quota');
  });

  it('reports an ambiguous graph match as a guess, not a mapping', async () => {
    // Two Coverage fields both end in `limit`: the graph step must not pick one.
    const schema = {
      resources: [
        ...MINI_SCHEMA.resources.filter((r) => r.name !== 'Coverage'),
        {
          name: 'Coverage',
          fields: [
            { path: 'id', type: 'number' },
            { path: 'a.limit', type: 'number' },
            { path: 'b.limit', type: 'number' },
          ],
        },
      ],
    };
    const r = await locateFields({ schema, graph: GRAPH, needed: [need('coverage.lines[].limit')] });
    expect(r.located).toEqual([]);
    expect(r.fieldMap.unmapped[0]).toMatchObject({
      rawPath: 'Coverage.a.limit',
      bestGuess: { canonicalPath: 'coverage.lines[].limit', confidence: 0.6 },
    });
  });

  it('locates every commercial needed field against the mini schema without an assist', async () => {
    const needed = collectNeededFields({
      spec: COMMERCIAL_SPEC,
      rulebook: COMMERCIAL_RULES,
      extensions: EXTENSIONS,
      ratingTable: COMMERCIAL_RATING,
    });
    // Only the names whose Federato spelling differs from the canonical leaf
    // need the synonym table; everything else is found by the graph step.
    syn('submissionType', 'Policy', 'business_type');
    syn('pricing.quotedPremium', 'Policy', 'premium');
    syn('history[].reserves', 'Claim', 'reserve_indemnity');
    syn('receivedDate', 'Submission', 'received_date');
    const r = await locateFields({ ...base, needed });
    // The mini (and live) Building has no protection class; Location does.
    // That stays visibly unmapped, with the Location field as the rejected guess.
    // Federato's schema has no flood field at all, so the flood zone can only
    // ever come from enrichment and stays unmapped on purpose: the planner
    // records the gap instead of pretending the carrier supplies it.
    expect(r.unmapped.map((u) => u.canonicalPath)).toEqual([
      'buildings[].protectionClass',
      'locations[].floodZone',
    ]);
    expect(r.fieldMap.unmapped[0]).toMatchObject({
      rawPath: 'Location.protection_class',
      bestGuess: { canonicalPath: 'buildings[].protectionClass', confidence: 0.6 },
    });
    // Two of the needed fields are unmapped, so the rest are located.
    expect(r.located).toHaveLength(needed.length - 2);
    const by = new Map(r.located.map((l) => [l.canonicalPath, l]));
    expect(by.get('history[].dateOfLoss')?.schemaPath).toBe('claims.date_of_loss');
    expect(by.get('history[].dateOfLoss')?.crossesArray).toBe(true);
    expect(by.get('history[].paidIndemnity')?.schemaPath).toBe('claims.paid_indemnity');
    expect(by.get('lineOfBusiness')?.schemaPath).toBe('line_of_business');
    expect(by.get('lineOfBusiness')?.rootResource).toBe('Policy');
    expect(by.get('receivedDate')?.rootResource).toBe('Submission');
    expect(by.get('locations[].protectionClass')?.schemaPath).toBe('exposure_units.location.protection_class');
    for (const l of r.located) expect(l.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
