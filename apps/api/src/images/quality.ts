/**
 * The code-side quality gate that runs BEFORE Gemini (PRD §9.3 step 1).
 * Body owned by Run 1 unit A09.
 */
import { phashDistance } from './metrics';
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

/** Laplacian variance (on the 512px analysis image) at which sharpness scores 1. */
const SHARP_FULL = 100;
/** Brightness band scoring 1, and the extremes where it reaches 0. */
const BRIGHT_OK_LO = 0.2;
const BRIGHT_OK_HI = 0.8;
const BRIGHT_ZERO_LO = 0.05;
const BRIGHT_ZERO_HI = 0.95;
/** Clipped share scoring 1, and where it reaches 0. */
const CLIP_OK = 0.05;
const CLIP_ZERO = 0.3;
/** Short side (px) scoring 1, and where it reaches 0. */
const RES_FULL = 480;
const RES_ZERO = 160;
/** pHash Hamming distance at or under which a frame duplicates the previous one. */
const DUPLICATE_MAX_DISTANCE = 5;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ramp = (v: number, zero: number, full: number): number => clamp01((v - zero) / (full - zero));

type Component = 'blur' | 'too_dark' | 'too_bright' | 'clipped' | 'low_resolution';

export function gradeFrame(metrics: ImageMetrics, previous?: ImageMetrics): QualityVerdict {
  const b = metrics.meanBrightness;
  const scores: [Component, number][] = [
    ['blur', clamp01(metrics.laplacianVariance / SHARP_FULL)],
    [
      b < BRIGHT_OK_LO ? 'too_dark' : 'too_bright',
      b < BRIGHT_OK_LO
        ? ramp(b, BRIGHT_ZERO_LO, BRIGHT_OK_LO)
        : b > BRIGHT_OK_HI
          ? ramp(b, BRIGHT_ZERO_HI, BRIGHT_OK_HI)
          : 1,
    ],
    ['clipped', ramp(metrics.clippedShare, CLIP_ZERO, CLIP_OK)],
    ['low_resolution', ramp(Math.min(metrics.width, metrics.height), RES_ZERO, RES_FULL)],
  ];

  // The weakest dimension decides: a frame is only as usable as its worst defect.
  let worst = scores[0]!;
  for (const s of scores) if (s[1] < worst[1]) worst = s;
  const quality = Math.round(worst[1] * 1000) / 1000;

  const duplicateOfPrevious =
    previous !== undefined && phashDistance(metrics.phash, previous.phash) <= DUPLICATE_MAX_DISTANCE;

  const lowQuality = quality < QUALITY_THRESHOLD;
  return {
    quality,
    pass: !lowQuality && !duplicateOfPrevious,
    reason: lowQuality ? worst[0] : duplicateOfPrevious ? 'duplicate' : null,
    duplicateOfPrevious,
  };
}
