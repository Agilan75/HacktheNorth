/** Resource graph and shortest reference path. Body owned by Run 1 unit F07. */
import type { SchemaDocument } from '@retrofit/engine';
import type { FederatoResource, GraphPath, ResourceEdge, ResourceGraph } from '../types';

/** The twelve resources `FederatoResource` admits. Anything else in a schema is ignored. */
const KNOWN_RESOURCES: ReadonlySet<string> = new Set<FederatoResource>([
  'Submission',
  'Policy',
  'Insured',
  'Location',
  'Building',
  'ExposureUnit',
  'Coverage',
  'Claim',
  'Endorsement',
  'Broker',
  'Contact',
  'Underwriter',
]);

/** Default hop bound for `pathsFrom`: the deep pass needs 3 (`exposure_units.location.buildings`). */
const DEFAULT_MAX_HOPS = 3;

/** Step 1 of PRD §7.5: read the live schema into a resource graph. */
export function buildResourceGraph(schema: SchemaDocument): ResourceGraph {
  const resources = new Set<FederatoResource>();
  const edges: ResourceEdge[] = [];
  const seen = new Set<string>();
  for (const resource of schema?.resources ?? []) {
    if (!isKnown(resource?.name)) continue;
    resources.add(resource.name);
  }
  for (const resource of schema?.resources ?? []) {
    if (!isKnown(resource?.name)) continue;
    for (const field of resource.fields ?? []) {
      const target = field?.reference;
      if (!isKnown(target) || typeof field.path !== 'string' || field.path === '') continue;
      const key = `${resource.name}|${field.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: resource.name,
        to: target,
        field: field.path,
        cardinality: field.isArray === true ? 'many' : 'one',
      });
      // A reference to a resource the schema does not describe still makes it a node.
      resources.add(target);
    }
  }
  edges.sort((a, b) => cmp(a.from, b.from) || cmp(a.field, b.field) || cmp(a.to, b.to));
  return { resources: [...resources].sort(cmp), edges };
}

/** Breadth-first shortest path. Ties break on fewer `many` hops, then name. */
export function shortestPath(
  graph: ResourceGraph,
  from: FederatoResource,
  to: FederatoResource,
): GraphPath | null {
  const nodes = new Set(graph.resources);
  if (!nodes.has(from) || !nodes.has(to)) return null;
  if (from === to) return makePath(from, []);

  // Layered BFS over simple paths: every path of length k is expanded before
  // any of length k+1, so the first layer that reaches `to` holds all the
  // shortest candidates, and the tie-break picks among them.
  let frontier: ResourceEdge[][] = [[]];
  for (let depth = 1; depth <= nodes.size; depth += 1) {
    const next: ResourceEdge[][] = [];
    const hits: GraphPath[] = [];
    for (const prefix of frontier) {
      const at = prefix.length === 0 ? from : prefix[prefix.length - 1]!.to;
      const visited = visitedOf(from, prefix);
      for (const edge of outgoing(graph, at)) {
        if (visited.has(edge.to)) continue;
        const edgesSoFar = [...prefix, edge];
        if (edge.to === to) hits.push(makePath(from, edgesSoFar));
        else next.push(edgesSoFar);
      }
    }
    if (hits.length > 0) return [...hits].sort(comparePaths)[0]!;
    if (next.length === 0) return null;
    frontier = next;
  }
  return null;
}

/** Every path from a root, shortest first. Used to record rejected alternatives. */
export function pathsFrom(
  graph: ResourceGraph,
  from: FederatoResource,
  maxHops: number = DEFAULT_MAX_HOPS,
): readonly GraphPath[] {
  if (!graph.resources.includes(from)) return [];
  const bound = Number.isFinite(maxHops) ? Math.max(0, Math.floor(maxHops)) : graph.resources.length;
  const out: GraphPath[] = [];
  const walk = (prefix: readonly ResourceEdge[], visited: ReadonlySet<FederatoResource>): void => {
    if (prefix.length >= bound) return;
    const at = prefix.length === 0 ? from : prefix[prefix.length - 1]!.to;
    for (const edge of outgoing(graph, at)) {
      if (visited.has(edge.to)) continue;
      const edgesSoFar = [...prefix, edge];
      out.push(makePath(from, edgesSoFar));
      walk(edgesSoFar, new Set([...visited, edge.to]));
    }
  };
  walk([], new Set([from]));
  return out.sort(comparePaths);
}

/** Turns a graph path into the `expand` clause that hydrates it. */
export function expandForPath(path: GraphPath): Readonly<Record<string, unknown>> {
  const segments = path.edges.flatMap((edge) => edge.field.split('.').filter((s) => s !== ''));
  if (segments.length === 0) return {};
  let clause: Record<string, unknown> | true = true;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    clause = { [segments[i]!]: clause };
  }
  return clause as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Private                                                                    */
/* -------------------------------------------------------------------------- */

function isKnown(name: unknown): name is FederatoResource {
  return typeof name === 'string' && KNOWN_RESOURCES.has(name);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function outgoing(graph: ResourceGraph, at: FederatoResource): readonly ResourceEdge[] {
  return graph.edges.filter((e) => e.from === at);
}

function visitedOf(from: FederatoResource, edges: readonly ResourceEdge[]): Set<FederatoResource> {
  const visited = new Set<FederatoResource>([from]);
  for (const e of edges) visited.add(e.to);
  return visited;
}

function manyHops(path: GraphPath): number {
  return path.edges.filter((e) => e.cardinality === 'many').length;
}

/** Fewer hops, then fewer `many` hops, then dot-path name, then target name. */
function comparePaths(a: GraphPath, b: GraphPath): number {
  return (
    a.hops - b.hops ||
    manyHops(a) - manyHops(b) ||
    cmp(a.dotPath, b.dotPath) ||
    cmp(a.to, b.to)
  );
}

function makePath(from: FederatoResource, edges: readonly ResourceEdge[]): GraphPath {
  return {
    from,
    to: edges.length === 0 ? from : edges[edges.length - 1]!.to,
    edges,
    dotPath: edges.map((e) => e.field).join('.'),
    crossesArray: edges.some((e) => e.cardinality === 'many'),
    hops: edges.length,
  };
}
