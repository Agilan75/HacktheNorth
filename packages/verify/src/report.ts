import type { LayerCSummary, RunSummary } from './types.js';

/**
 * VERIFICATION.md writer (V07). Reports the count actually completed, the
 * agreement rate with its 95% interval, and every layer-C disagreement with
 * both sides' reasoning.
 *
 * Stubs frozen by W0-4; unit V07 replaces these bodies only.
 */
export function renderReport(_run: RunSummary, _layerC: LayerCSummary | null): string {
  throw new Error('NOT_IMPLEMENTED:V07');
}

/** The machine-readable summary the API's /aggregate route reads. */
export function renderSummaryJson(
  _run: RunSummary,
  _layerC: LayerCSummary | null,
): Readonly<Record<string, unknown>> {
  throw new Error('NOT_IMPLEMENTED:V07');
}
