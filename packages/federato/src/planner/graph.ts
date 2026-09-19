/** Resource graph and shortest reference path. Body owned by Run 1 unit F07. */
import type { SchemaDocument } from '@retrofit/engine';
import type { FederatoResource, GraphPath, ResourceGraph } from '../types';

/** Step 1 of PRD §7.5: read the live schema into a resource graph. */
export function buildResourceGraph(_schema: SchemaDocument): ResourceGraph {
  throw new Error('NOT_IMPLEMENTED:F07');
}

/** Breadth-first shortest path. Ties break on fewer `many` hops, then name. */
export function shortestPath(
  _graph: ResourceGraph,
  _from: FederatoResource,
  _to: FederatoResource,
): GraphPath | null {
  throw new Error('NOT_IMPLEMENTED:F07');
}

/** Every path from a root, shortest first. Used to record rejected alternatives. */
export function pathsFrom(
  _graph: ResourceGraph,
  _from: FederatoResource,
  _maxHops?: number,
): readonly GraphPath[] {
  throw new Error('NOT_IMPLEMENTED:F07');
}

/** Turns a graph path into the `expand` clause that hydrates it. */
export function expandForPath(_path: GraphPath): Readonly<Record<string, unknown>> {
  throw new Error('NOT_IMPLEMENTED:F07');
}
