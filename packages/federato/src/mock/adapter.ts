/** MockFederatoAdapter over the saved snapshot. Body owned by Run 1 unit F05. */
import type { SchemaDocument } from '@retrofit/engine';
import type {
  FederatoAdapter,
  FederatoSnapshot,
  GlossaryDocument,
  GuidelinesDocument,
} from '../types';

export interface MockAdapterOptions {
  readonly snapshot: FederatoSnapshot;
  readonly guidelines?: GuidelinesDocument;
  readonly glossary?: GlossaryDocument;
  readonly schema?: SchemaDocument;
}

/**
 * Implements the same `query` contract as the live adapter over saved records —
 * at least the subset the planner emits. Same input, same output, no network.
 */
export function createMockAdapter(_options: MockAdapterOptions): FederatoAdapter {
  throw new Error('NOT_IMPLEMENTED:F05');
}
