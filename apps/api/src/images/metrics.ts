/**
 * Image metrics with `sharp`: variance of Laplacian (blur), mean brightness,
 * clipped-pixel share, resolution and a perceptual hash.
 * Body owned by Run 1 unit A09.
 */
export interface ImageMetrics {
  readonly width: number;
  readonly height: number;
  /** Variance of the Laplacian. Low means blurred. */
  readonly laplacianVariance: number;
  /** 0..1. */
  readonly meanBrightness: number;
  /** 0..1, share of pixels at 0 or 255. */
  readonly clippedShare: number;
  /** 64-bit perceptual hash as 16 hex characters. */
  readonly phash: string;
}

export function imageMetrics(_data: Uint8Array): Promise<ImageMetrics> {
  throw new Error('NOT_IMPLEMENTED:A09');
}

/** Hamming distance between two pHashes, 0..64. */
export function phashDistance(_a: string, _b: string): number {
  throw new Error('NOT_IMPLEMENTED:A09');
}
