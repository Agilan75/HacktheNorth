import type { LayerCCaseResult, LayerCConfig, LayerCSummary } from './types.js';

/**
 * Layer-C runner (V09), PRD §12: all 38 real property submissions plus ~2,000
 * stratified generated cases. Disk cache keyed by case id so a run resumes,
 * concurrency 2 so the Gemini quota survives.
 *
 * Stubs frozen by W0-4; unit V09 replaces these bodies only.
 */
export function runLayerC(_config: LayerCConfig): Promise<LayerCSummary> {
  throw new Error('NOT_IMPLEMENTED:V09');
}

export function judgeOne(_caseId: string, _factsText: string): Promise<LayerCCaseResult> {
  throw new Error('NOT_IMPLEMENTED:V09');
}
