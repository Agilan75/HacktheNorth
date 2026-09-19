import { readFileSync } from 'node:fs';
import type { SchemaDocument, SchemaField } from '@retrofit/engine';
import { describe, expect, it } from 'vitest';
import type { FederatoResource, ResourceGraph } from '../types';
import { buildResourceGraph, expandForPath, pathsFrom, shortestPath } from './graph';

interface RawField {
  readonly type: string;
  readonly optional?: boolean;
  readonly resource?: string;
  readonly cardinality?: string;
  readonly fields?: Record<string, RawField>;
}

/** Same flattening the live adapter applies to `GET /schema`. */
function flatten(fields: Record<string, RawField>, prefix: string, out: SchemaField[]): void {
  for (const [name, def] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (def.type === 'object' && def.fields) {
      flatten(def.fields, path, out);
      continue;
    }
    const f: { path: string; type: string; reference?: string; isArray?: boolean } = { path, type: def.type };
    if (def.type === 'reference' && def.resource) {
      f.reference = def.resource;
      if (def.cardinality === 'many') f.isArray = true;
    }
    out.push(f);
  }
}

const raw = JSON.parse(
  readFileSync(new URL('../../../../docs/federato/live-schema.json', import.meta.url), 'utf8'),
) as Record<string, { fields: Record<string, RawField> }>;

const SCHEMA: SchemaDocument = {
  resources: Object.entries(raw).map(([name, def]) => {
    const fields: SchemaField[] = [];
    flatten(def.fields, '', fields);
    return { name, fields };
  }),
};

const graph: ResourceGraph = buildResourceGraph(SCHEMA);

describe('buildResourceGraph', () => {
  it('has the twelve resources and the 22 reference edges of the live schema', () => {
    expect(graph.resources).toHaveLength(12);
    expect(graph.edges).toHaveLength(22);
    expect(graph.edges.filter((e) => e.from === 'Policy')).toHaveLength(9);
    expect(graph.edges.filter((e) => e.cardinality === 'many').map((e) => `${e.from}.${e.field}`)).toEqual([
      'Location.buildings',
      'Policy.claims',
      'Policy.coverages',
      'Policy.endorsements',
      'Policy.exposure_units',
    ]);
  });

  it('keeps nested-object reference paths as one edge', () => {
    expect(graph.edges).toContainEqual({ from: 'Policy', to: 'Broker', field: 'producer.broker', cardinality: 'one' });
    expect(graph.edges).toContainEqual({ from: 'ExposureUnit', to: 'Policy', field: 'underlying_layer.policy', cardinality: 'one' });
  });

  it('ignores unknown resources and non-reference fields', () => {
    const g = buildResourceGraph({
      resources: [
        { name: 'Policy', fields: [{ path: 'premium', type: 'number' }, { path: 'insured', type: 'reference', reference: 'Insured' }] },
        { name: 'Widget', fields: [{ path: 'policy', type: 'reference', reference: 'Policy' }] },
      ],
    });
    expect(g.resources).toEqual(['Insured', 'Policy']);
    expect(g.edges).toEqual([{ from: 'Policy', to: 'Insured', field: 'insured', cardinality: 'one' }]);
  });
});

describe('shortestPath', () => {
  it('Submission has no route to Policy (no reverse reference; LIVE_DATA_FACTS)', () => {
    expect(shortestPath(graph, 'Submission', 'Policy')).toBeNull();
  });

  it('one-hop references', () => {
    const p = shortestPath(graph, 'Policy', 'Broker')!;
    expect(p).toMatchObject({ dotPath: 'producer.broker', hops: 1, crossesArray: false });
    expect(shortestPath(graph, 'Policy', 'Claim')).toMatchObject({ dotPath: 'claims', hops: 1, crossesArray: true });
  });

  it('breaks equal-hop ties on fewer many hops', () => {
    // exposure_units.location (1 many) loses to insured.hq (0 many).
    expect(shortestPath(graph, 'Policy', 'Location')).toMatchObject({ dotPath: 'insured.hq', hops: 2, crossesArray: false });
    // exposure_units.location.buildings (2 many) loses to insured.hq.buildings (1 many).
    expect(shortestPath(graph, 'Policy', 'Building')).toMatchObject({ dotPath: 'insured.hq.buildings', hops: 3, crossesArray: true });
  });

  it('Submission reaches Building through insured.hq.buildings', () => {
    expect(shortestPath(graph, 'Submission', 'Building')?.dotPath).toBe('insured.hq.buildings');
  });

  it('zero-hop and unknown endpoints', () => {
    expect(shortestPath(graph, 'Policy', 'Policy')).toEqual({
      from: 'Policy', to: 'Policy', edges: [], dotPath: '', crossesArray: false, hops: 0,
    });
    expect(shortestPath({ resources: ['Policy'], edges: [] }, 'Policy', 'Claim')).toBeNull();
  });
});

describe('pathsFrom', () => {
  it('lists every simple path shortest first, including the deep-pass path', () => {
    const paths = pathsFrom(graph, 'Policy');
    const hops = paths.map((p) => p.hops);
    expect([...hops].sort((a, b) => a - b)).toEqual(hops);
    expect(paths.filter((p) => p.hops === 1)).toHaveLength(9);
    const toBuilding = paths.filter((p) => p.to === 'Building').map((p) => p.dotPath);
    expect(toBuilding).toEqual(['insured.hq.buildings', 'exposure_units.location.buildings']);
    expect(Math.max(...hops)).toBe(3);
  });

  it('respects maxHops and never revisits a resource', () => {
    expect(pathsFrom(graph, 'Policy', 1).every((p) => p.hops === 1)).toBe(true);
    expect(pathsFrom(graph, 'Policy', 0)).toEqual([]);
    for (const p of pathsFrom(graph, 'Policy', 6)) {
      const seen = new Set<FederatoResource>([p.from, ...p.edges.map((e) => e.to)]);
      expect(seen.size).toBe(p.hops + 1);
    }
    expect(pathsFrom(graph, 'Broker')).toEqual([]);
  });
});

describe('expandForPath', () => {
  it('builds the nested expand clause the deep pass uses', () => {
    const deep = pathsFrom(graph, 'Policy').find((p) => p.dotPath === 'exposure_units.location.buildings')!;
    expect(expandForPath(deep)).toEqual({ exposure_units: { location: { buildings: true } } });
  });

  it('nests nested-object reference fields and handles empty paths', () => {
    expect(expandForPath(shortestPath(graph, 'Policy', 'Broker')!)).toEqual({ producer: { broker: true } });
    expect(expandForPath(shortestPath(graph, 'Submission', 'Location')!)).toEqual({ insured: { hq: true } });
    expect(expandForPath(shortestPath(graph, 'Policy', 'Policy')!)).toEqual({});
  });
});
