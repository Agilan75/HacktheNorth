/**
 * The code-side quality gate that runs BEFORE Gemini (PRD §9.3 step 1).
 * Body owned by Run 1 unit A09.
 */
import type { ImageMetrics } from './metrics';

export interface QualityVerdict {
  /** 0..1. Frames under the threshold are dropped before any model call. */
  readonly quality: number;
  readonly pass: boolean;
  readonly reason: string | null;
  /** True when this frame is a near-duplicate of the previous one. */
  readonly duplicateOfPrevious: boolean;
}

export const QUALITY_THRESHOLD = 0.4;

export function gradeFrame(
  _metrics: ImageMetrics,
  _previous?: ImageMetrics,
): QualityVerdict {
  throw new Error('NOT_IMPLEMENTED:A09');
}
