import type { ChunkRequest, ChunkResult } from './types.js';

/**
 * One verification worker (V08). Entry point for `node --import tsx worker.ts`,
 * driven by the pool over `worker_threads` messages. Runs layer A invariants
 * and the layer B comparator over one chunk and reports partial counts.
 *
 * Stubs frozen by W0-4; unit V08 replaces these bodies only.
 */
export function runChunk(_request: ChunkRequest): ChunkResult {
  throw new Error('NOT_IMPLEMENTED:V08');
}

export function startWorker(): void {
  throw new Error('NOT_IMPLEMENTED:V08');
}
