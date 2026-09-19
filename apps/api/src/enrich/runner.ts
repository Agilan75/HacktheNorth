/**
 * Runs every plugin, turns failures into "unavailable" cards, and returns the
 * merged `ExternalValue[]`. Body owned by Run 1 unit A08.
 */
import type { EnrichContext, EnrichOutcome, EnrichPlugin } from './types';

export function defaultPlugins(): readonly EnrichPlugin[] {
  throw new Error('NOT_IMPLEMENTED:A08');
}

export function runEnrichment(
  _context: EnrichContext,
  _plugins?: readonly EnrichPlugin[],
): Promise<readonly EnrichOutcome[]> {
  throw new Error('NOT_IMPLEMENTED:A08');
}
