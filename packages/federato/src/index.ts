/**
 * `@retrofit/federato` — public barrel. FROZEN after Run 0 (W0-3).
 *
 * Cross-package imports must come through here, never through a deep path into
 * `packages/federato/src`. Run 1 units F01–F13 fill the bodies behind these
 * names; nobody adds or removes an export.
 */

export * from './types';

export { createTokenSource, mintToken, isExpired, TOKEN_REFRESH_MARGIN_MS } from './auth';
export type { TokenSource } from './auth';

export {
  createLiveAdapter,
  liveQuery,
  liveSchema,
  liveGuidelines,
  liveGlossary,
  parseFederatoError,
  unwrapEnvelope,
} from './live-adapter';
export type { LiveAdapterOptions } from './live-adapter';

export { createAdapter, selectAdapterKind, adapterBanner } from './create-adapter';
export type { CreateAdapterOptions } from './create-adapter';

export {
  applyWhere,
  deepEqual,
  matchClause,
  matchContains,
  matchElemMatch,
  matchOperators,
  readDotPath,
} from './mock/where';
export {
  applyExpand,
  applyOver,
  applyPagination,
  applySelect,
  applySort,
  applyUnwind,
  buildReferenceIndex,
  runPipeline,
} from './mock/pipeline';
export type { RecordStore, ReferenceIndex } from './mock/pipeline';
export { createMockAdapter } from './mock/adapter';
export type { MockAdapterOptions } from './mock/adapter';

export {
  EXPECTED_COUNTS,
  SNAPSHOT_DIR,
  loadSnapshot,
  saveSnapshot,
  snapshotPath,
  verifySnapshotCounts,
} from './snapshot/index';

export { GUIDELINES_DOC, guidelineRows, readGuidelines } from './reference/guidelines';
export { GLOSSARY_DOC, glossaryEntries, lookupTerm, readGlossary } from './reference/glossary';
export { queryLanguageNotes } from './reference/query-language';
export type { QueryLanguageNote } from './reference/query-language';
export { referenceDocuments, resolveCitation } from './reference/index';
export type { ReferenceDocument } from './reference/index';

export { lookupSynonym, reverseSynonym, synonymTable } from './planner/synonyms';
export { buildResourceGraph, expandForPath, pathsFrom, shortestPath } from './planner/graph';
export { collectNeededFields } from './planner/collect';
export type { CollectInput } from './planner/collect';
export { locateFields } from './planner/locate';
export type { LocateInput } from './planner/locate';
export {
  buildPlan,
  planDeep,
  planFollowUps,
  planNoPolicy,
  planTriage,
  triageRows,
} from './planner/plan';
export type { PlanInput } from './planner/plan';
export { externalIdOf, toBundles } from './planner/to-bundle';
export type { ToBundleInput } from './planner/to-bundle';
export { dropNarrowestFilter, nextAdaptation, swapToElemMatch } from './planner/adapt';
export type { Adaptation } from './planner/adapt';
export { createTraceRecorder } from './planner/trace';
export type {
  TraceFinish,
  TraceRecorder,
  TraceRecorderOptions,
  TraceStart,
} from './planner/trace';
export { runFollowUps, runPlanner } from './planner/run';
export type { RunPlannerInput } from './planner/run';

export { explain, mixedCaseSentence, recommendationFor } from './explain/template';
export type { ExplainInput } from './explain/template';
export { extractNumbers, narrateGuard } from './explain/narrate-guard';

export { regionForState, route } from './actions/routing';
export type { RoutingInput } from './actions/routing';
export { selectRequest } from './actions/request';
export type { RequestSelectionInput } from './actions/request';
export { validateDraft, validateExtraction } from './actions/validate';
export type { ValidateExtractionInput } from './actions/validate';
export { applyReply, conflictingPaths } from './actions/apply-reply';
export type { ApplyReplyInput } from './actions/apply-reply';
