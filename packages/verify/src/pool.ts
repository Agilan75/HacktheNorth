import type { ChunkRequest, ChunkResult, RunConfig, RunSummary } from './types.js';

/**
 * Worker pool (V08): chunked, seeded, reports partial counts so an interrupted
 * run still says how many cases really completed. Workers are spawned with
 * `execArgv: ['--import', 'tsx']`.
 *
 * Stubs frozen by W0-4; unit V08 replaces these bodies only.
 */
export function planChunks(_config: RunConfig): readonly ChunkRequest[] {
  throw new Error('NOT_IMPLEMENTED:V08');
}

export function runPool(
  _config: RunConfig,
  _onChunk?: (result: ChunkResult) => void,
): Promise<RunSummary> {
  throw new Error('NOT_IMPLEMENTED:V08');
}
