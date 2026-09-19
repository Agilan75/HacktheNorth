/**
 * Stage composer. Body owned by Run 1 unit E16.
 *
 * Runs stages 3-11 in order over one submission; `peers` (12) and `rank` (13)
 * run over the whole book afterwards. Pure: every clock value arrives on
 * `input.asOf`.
 */
import type { EngineConfig, EngineInput, EngineResult } from './types.js';

export function runEngine(_input: EngineInput, _config: EngineConfig): EngineResult {
  throw new Error('NOT_IMPLEMENTED:E16');
}
