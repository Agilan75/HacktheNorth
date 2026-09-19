/**
 * Step 3 of PRD §7.5: locate each needed field in the schema — synonym table
 * first, then a graph search, then the injected Gemini assist at >= 0.8.
 * Names that resolve below the gate stay visibly unmapped.
 * Body owned by Run 1 unit F08.
 */
import type { SchemaDocument } from '@retrofit/engine';
import type {
  LocateResult,
  NeededField,
  ResourceGraph,
  SchemaAssistFn,
} from '../types';

export interface LocateInput {
  readonly needed: readonly NeededField[];
  readonly schema: SchemaDocument;
  readonly graph: ResourceGraph;
  /** Injected. Absent means the planner stays fully deterministic. */
  readonly schemaAssist?: SchemaAssistFn | undefined;
}

export function locateFields(_input: LocateInput): Promise<LocateResult> {
  throw new Error('NOT_IMPLEMENTED:F08');
}
