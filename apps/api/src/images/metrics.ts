/**
 * Image metrics with `sharp`: variance of Laplacian (blur), mean brightness,
 * clipped-pixel share, resolution and a perceptual hash.
 * Body owned by Run 1 unit A09.
 */
import sharp from 'sharp';

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

/**
 * Longest side of the grayscale buffer the blur / exposure metrics run on.
 * Normalising the analysis size keeps Laplacian variance comparable across
 * phone resolutions (A09-1).
 */
const ANALYSIS_MAX_SIDE = 512;
const PHASH_SIZE = 32;
const PHASH_LOW = 8;

async function grayscale(
  data: Uint8Array,
  resize: sharp.ResizeOptions,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const { data: buf, info } = await sharp(data)
    .autoOrient()
    .flatten({ background: '#ffffff' })
    .resize(resize)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // grayscale().raw() yields one channel.
  const pixels = new Uint8Array(buf.buffer, buf.byteOffset, info.width * info.height);
  return { pixels, width: info.width, height: info.height };
}

function laplacianVariance(p: Uint8Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const v = p[i - w]! + p[i + w]! + p[i - 1]! + p[i + 1]! - 4 * p[i]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

/** DCT-II cosine table, [k][n]. */
const DCT_TABLE: readonly Float64Array[] = Array.from({ length: PHASH_LOW }, (_, k) => {
  const row = new Float64Array(PHASH_SIZE);
  for (let n = 0; n < PHASH_SIZE; n++) {
    row[n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * PHASH_SIZE));
  }
  return row;
});

/** Classic DCT pHash: 32x32 gray, low 8x8 DCT block, bit = coef > median (DC excluded from median). */
function phashOf(p: Uint8Array): string {
  const N = PHASH_SIZE;
  // Rows first: tmp[y][u] for u < 8.
  const tmp = new Float64Array(N * PHASH_LOW);
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < PHASH_LOW; u++) {
      const cos = DCT_TABLE[u]!;
      let s = 0;
      for (let x = 0; x < N; x++) s += p[y * N + x]! * cos[x]!;
      tmp[y * PHASH_LOW + u] = s;
    }
  }
  const coeffs = new Float64Array(PHASH_LOW * PHASH_LOW);
  for (let v = 0; v < PHASH_LOW; v++) {
    const cos = DCT_TABLE[v]!;
    for (let u = 0; u < PHASH_LOW; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += tmp[y * PHASH_LOW + u]! * cos[y]!;
      coeffs[v * PHASH_LOW + u] = s;
    }
  }
  const ac = Array.from(coeffs.subarray(1)).sort((a, b) => a - b);
  const median = (ac[31]! + ac[32]!) / 2;
  let hex = '';
  for (let nibble = 0; nibble < 16; nibble++) {
    let bits = 0;
    for (let b = 0; b < 4; b++) {
      bits = (bits << 1) | (coeffs[nibble * 4 + b]! > median ? 1 : 0);
    }
    hex += bits.toString(16);
  }
  return hex;
}

export async function imageMetrics(data: Uint8Array): Promise<ImageMetrics> {
  const meta = await sharp(data).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('imageMetrics: could not read image dimensions');
  }
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;

  const analysis = await grayscale(data, {
    width: ANALYSIS_MAX_SIDE,
    height: ANALYSIS_MAX_SIDE,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const { pixels, width: aw, height: ah } = analysis;

  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i]!;
    sum += v;
    if (v === 0 || v === 255) clipped++;
  }
  const count = pixels.length;

  const small = await grayscale(data, { width: PHASH_SIZE, height: PHASH_SIZE, fit: 'fill' });

  return {
    width,
    height,
    laplacianVariance: laplacianVariance(pixels, aw, ah),
    meanBrightness: count === 0 ? 0 : sum / count / 255,
    clippedShare: count === 0 ? 0 : clipped / count,
    phash: phashOf(small.pixels),
  };
}

/** Hamming distance between two pHashes, 0..64. */
export function phashDistance(a: string, b: string): number {
  if (!/^[0-9a-fA-F]{16}$/.test(a) || !/^[0-9a-fA-F]{16}$/.test(b)) {
    throw new Error('phashDistance: expected two 16-character hex hashes');
  }
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let d = 0;
  while (x > 0n) {
    d += Number(x & 1n);
    x >>= 1n;
  }
  return d;
}
