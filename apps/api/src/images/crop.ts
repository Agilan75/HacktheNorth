/**
 * Crops a frame to a Gemini `box_2d` for the hazard detail screen.
 * Body owned by Run 1 unit A09.
 */
import sharp from 'sharp';

export interface CropRequest {
  readonly data: Uint8Array;
  /** `[y0, x0, y1, x1]` in 0..1000, as Gemini returns it. */
  readonly box2d: readonly [number, number, number, number];
  /** Extra margin as a share of the box, e.g. 0.1. */
  readonly padding?: number;
}

/** Absorbs float noise like 0.2 - 0.02 = 0.18000000000000002 before floor/ceil. */
const EPS = 1e-6;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Pixel rectangle for a box on an oriented `width`x`height` image. */
function toRegion(
  box2d: readonly [number, number, number, number],
  padding: number,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  if (!box2d.every(Number.isFinite)) throw new Error('cropToBox: box_2d must be four finite numbers');
  const [a, b, c, d] = box2d.map((v) => clamp(v, 0, 1000) / 1000) as [number, number, number, number];
  let y0 = Math.min(a, c);
  let y1 = Math.max(a, c);
  let x0 = Math.min(b, d);
  let x1 = Math.max(b, d);
  const pad = Math.max(0, padding);
  const py = (y1 - y0) * pad;
  const px = (x1 - x0) * pad;
  y0 = clamp(y0 - py, 0, 1);
  y1 = clamp(y1 + py, 0, 1);
  x0 = clamp(x0 - px, 0, 1);
  x1 = clamp(x1 + px, 0, 1);

  const left = clamp(Math.floor(x0 * width + EPS), 0, width - 1);
  const top = clamp(Math.floor(y0 * height + EPS), 0, height - 1);
  const right = clamp(Math.ceil(x1 * width - EPS), left + 1, width);
  const bottom = clamp(Math.ceil(y1 * height - EPS), top + 1, height);
  return { left, top, width: right - left, height: bottom - top };
}

export async function cropToBox(request: CropRequest): Promise<Uint8Array> {
  // Orient first so box_2d (which Gemini gives on the upright image) lines up.
  const { data, info } = await sharp(request.data)
    .autoOrient()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const region = toRegion(request.box2d, request.padding ?? 0, info.width, info.height);
  const out = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .extract(region)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
