import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cropToBox } from './crop';
import { imageMetrics, phashDistance } from './metrics';
import { QUALITY_THRESHOLD, gradeFrame } from './quality';
import type { ImageMetrics } from './metrics';

/** Deterministic textured gray scene (LCG noise + gradient), mid exposure. */
function sceneRaw(w: number, h: number, seed = 1): Buffer {
  const buf = Buffer.alloc(w * h * 3);
  let s = seed >>> 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const noise = (s >>> 24) - 128; // -128..127
      const base = 90 + Math.round((x / w) * 60) + (((x >> 7) + (y >> 7)) % 2) * 40;
      const v = Math.max(1, Math.min(254, base + Math.round(noise * 0.35)));
      const i = (y * w + x) * 3;
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
    }
  }
  return buf;
}

const raw = (b: Buffer, w: number, h: number) => sharp(b, { raw: { width: w, height: h, channels: 3 } });
const png = async (s: sharp.Sharp) => new Uint8Array(await s.png().toBuffer());

async function solid(w: number, h: number, v: number): Promise<Uint8Array> {
  return png(sharp({ create: { width: w, height: h, channels: 3, background: { r: v, g: v, b: v } } }));
}

describe('imageMetrics', () => {
  it('reports resolution, exposure, clipping and a 16-hex pHash', async () => {
    const m = await imageMetrics(await png(raw(sceneRaw(640, 480), 640, 480)));
    expect(m.width).toBe(640);
    expect(m.height).toBe(480);
    expect(m.meanBrightness).toBeGreaterThan(0.4);
    expect(m.meanBrightness).toBeLessThan(0.65);
    expect(m.clippedShare).toBe(0);
    expect(m.phash).toMatch(/^[0-9a-f]{16}$/);
    expect(m.laplacianVariance).toBeGreaterThan(100);
  });

  it('solid black is fully clipped and dark; solid white fully clipped and bright; both have zero Laplacian', async () => {
    const black = await imageMetrics(await solid(600, 600, 0));
    expect(black.meanBrightness).toBe(0);
    expect(black.clippedShare).toBe(1);
    expect(black.laplacianVariance).toBe(0);
    const white = await imageMetrics(await solid(600, 600, 255));
    expect(white.meanBrightness).toBe(1);
    expect(white.clippedShare).toBe(1);
  });

  it('mid gray (128) has brightness 128/255 and no clipping', async () => {
    const m = await imageMetrics(await solid(500, 500, 128));
    expect(m.meanBrightness).toBeCloseTo(128 / 255, 6);
    expect(m.clippedShare).toBe(0);
  });

  it('blur lowers the Laplacian variance by an order of magnitude', async () => {
    const sharpImg = raw(sceneRaw(640, 480), 640, 480);
    const a = await imageMetrics(await png(sharpImg.clone()));
    const b = await imageMetrics(await png(raw(sceneRaw(640, 480), 640, 480).blur(6)));
    expect(b.laplacianVariance * 10).toBeLessThan(a.laplacianVariance);
  });

  it('pHash is stable under re-encoding and resizing, and different for a different scene', async () => {
    const base = await imageMetrics(await png(raw(sceneRaw(640, 480, 7), 640, 480).blur(2)));
    const jpg = await imageMetrics(
      new Uint8Array(await raw(sceneRaw(640, 480, 7), 640, 480).blur(2).resize(320, 240).jpeg({ quality: 70 }).toBuffer()),
    );
    expect(phashDistance(base.phash, jpg.phash)).toBeLessThanOrEqual(5);

    // A structurally different scene: the gradient flipped left-right.
    const flipped = await imageMetrics(await png(raw(sceneRaw(640, 480, 7), 640, 480).blur(2).flop()));
    expect(phashDistance(base.phash, flipped.phash)).toBeGreaterThan(10);
  });

  it('uses EXIF-oriented dimensions', async () => {
    const buf = await raw(sceneRaw(640, 480), 640, 480).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const m = await imageMetrics(new Uint8Array(buf));
    expect(m.width).toBe(480);
    expect(m.height).toBe(640);
  });
});

describe('phashDistance', () => {
  it('counts differing bits', () => {
    expect(phashDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(phashDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(phashDistance('0000000000000001', '0000000000000003')).toBe(1);
    expect(phashDistance('F0F0F0F0F0F0F0F0', 'f0f0f0f0f0f0f0f0')).toBe(0);
  });
  it('rejects malformed hashes', () => {
    expect(() => phashDistance('abc', '0000000000000000')).toThrow();
  });
});

describe('gradeFrame', () => {
  const good: ImageMetrics = {
    width: 1280,
    height: 720,
    laplacianVariance: 250,
    meanBrightness: 0.5,
    clippedShare: 0.01,
    phash: '0123456789abcdef',
  };

  it('a clean frame scores 1 and passes', () => {
    expect(gradeFrame(good)).toEqual({ quality: 1, pass: true, reason: null, duplicateOfPrevious: false });
  });

  it('threshold is 0.4', () => {
    expect(QUALITY_THRESHOLD).toBe(0.4);
  });

  it('blur: variance 30 scores 0.3 and fails; 40 scores exactly 0.4 and passes', () => {
    expect(gradeFrame({ ...good, laplacianVariance: 30 })).toEqual({
      quality: 0.3,
      pass: false,
      reason: 'blur',
      duplicateOfPrevious: false,
    });
    const edge = gradeFrame({ ...good, laplacianVariance: 40 });
    expect(edge.quality).toBe(0.4);
    expect(edge.pass).toBe(true);
  });

  it('exposure: 0.1 brightness is too dark (1/3), 0.9 too bright (1/3), 0.2..0.8 is full score', () => {
    const dark = gradeFrame({ ...good, meanBrightness: 0.1 });
    expect(dark.quality).toBeCloseTo(0.333, 3);
    expect(dark.reason).toBe('too_dark');
    expect(dark.pass).toBe(false);
    const bright = gradeFrame({ ...good, meanBrightness: 0.9 });
    expect(bright.quality).toBeCloseTo(0.333, 3);
    expect(bright.reason).toBe('too_bright');
    expect(gradeFrame({ ...good, meanBrightness: 0.2 }).quality).toBe(1);
    expect(gradeFrame({ ...good, meanBrightness: 0.8 }).quality).toBe(1);
  });

  it('clipping: 0.2 share scores 0.4; 0.25 scores 0.2 and fails as clipped', () => {
    expect(gradeFrame({ ...good, clippedShare: 0.2 }).quality).toBe(0.4);
    const v = gradeFrame({ ...good, clippedShare: 0.25 });
    expect(v.quality).toBe(0.2);
    expect(v.reason).toBe('clipped');
  });

  it('resolution: short side 240 scores 0.25 and fails; 480 scores 1', () => {
    const v = gradeFrame({ ...good, width: 320, height: 240 });
    expect(v.quality).toBe(0.25);
    expect(v.reason).toBe('low_resolution');
    expect(gradeFrame({ ...good, width: 640, height: 480 }).quality).toBe(1);
  });

  it('the worst dimension decides', () => {
    const v = gradeFrame({ ...good, laplacianVariance: 50, clippedShare: 0.25 });
    expect(v.quality).toBe(0.2);
    expect(v.reason).toBe('clipped');
  });

  it('near-duplicate of the previous frame (Hamming <= 5) is dropped even at full quality', () => {
    const dup = gradeFrame(good, { ...good, phash: '0123456789abcdee' }); // 1 bit
    expect(dup).toEqual({ quality: 1, pass: false, reason: 'duplicate', duplicateOfPrevious: true });
    expect(phashDistance(good.phash, '0123456789abcd0c')).toBe(5);
    expect(gradeFrame(good, { ...good, phash: '0123456789abcd0c' }).duplicateOfPrevious).toBe(true);
    expect(phashDistance(good.phash, '0123456789abcd08')).toBe(6);
    const six = gradeFrame(good, { ...good, phash: '0123456789abcd08' });
    expect(six.duplicateOfPrevious).toBe(false);
    expect(six.pass).toBe(true);
  });

  it('a low-quality duplicate reports the quality reason first', () => {
    const v = gradeFrame({ ...good, laplacianVariance: 10 }, good);
    expect(v.duplicateOfPrevious).toBe(true);
    expect(v.reason).toBe('blur');
  });

  it('real images end to end: sharp scene passes, blurred / black / tiny fail with the right reason', async () => {
    const scene = await imageMetrics(await png(raw(sceneRaw(640, 480), 640, 480)));
    expect(gradeFrame(scene).pass).toBe(true);
    const blurred = await imageMetrics(await png(raw(sceneRaw(640, 480), 640, 480).blur(8)));
    expect(gradeFrame(blurred).reason).toBe('blur');
    const black = await imageMetrics(await solid(640, 480, 0));
    expect(gradeFrame(black).pass).toBe(false);
    const tiny = await imageMetrics(await png(raw(sceneRaw(200, 150), 200, 150)));
    expect(gradeFrame(tiny).reason).toBe('low_resolution');
    const again = await imageMetrics(await png(raw(sceneRaw(640, 480), 640, 480)));
    expect(gradeFrame(again, scene).reason).toBe('duplicate');
  });
});

describe('cropToBox', () => {
  /** 1000x500 image: left half red, right half blue. */
  async function halves(): Promise<Uint8Array> {
    const left = await sharp({ create: { width: 500, height: 500, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    return png(
      sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 255 } } }).composite([
        { input: left, left: 0, top: 0 },
      ]),
    );
  }

  it('maps [y0,x0,y1,x1] in 0..1000 to pixels and returns a JPEG', async () => {
    const out = await cropToBox({ data: await halves(), box2d: [100, 600, 500, 900] });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(300); // x 600..900 of 1000px
    expect(meta.height).toBe(200); // y 100..500 of 500px
    const { dominant } = await sharp(out).stats();
    expect(dominant.b).toBeGreaterThan(200);
    expect(dominant.r).toBeLessThan(50);
  });

  it('applies padding as a share of the box and clamps to the frame', async () => {
    const out = await cropToBox({ data: await halves(), box2d: [200, 200, 400, 400], padding: 0.1 });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(240); // 200px box + 20px each side
    expect(meta.height).toBe(120); // 100px box + 10px each side
    const edge = await cropToBox({ data: await halves(), box2d: [0, 0, 1000, 1000], padding: 0.5 });
    const em = await sharp(edge).metadata();
    expect(em.width).toBe(1000);
    expect(em.height).toBe(500);
  });

  it('tolerates swapped corners, out-of-range values and zero-area boxes', async () => {
    const swapped = await sharp(await cropToBox({ data: await halves(), box2d: [500, 900, 100, 600] })).metadata();
    expect([swapped.width, swapped.height]).toEqual([300, 200]);
    const wild = await sharp(await cropToBox({ data: await halves(), box2d: [-50, -50, 1200, 1200] })).metadata();
    expect([wild.width, wild.height]).toEqual([1000, 500]);
    const zero = await sharp(await cropToBox({ data: await halves(), box2d: [500, 500, 500, 500] })).metadata();
    expect(zero.width).toBeGreaterThanOrEqual(1);
    expect(zero.height).toBeGreaterThanOrEqual(1);
  });

  it('crops in the EXIF-upright frame', async () => {
    // Stored 1000x500 with orientation 6 (rotate 90 CW) -> upright is 500x1000.
    const buf = await sharp(await halves()).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await sharp(await cropToBox({ data: new Uint8Array(buf), box2d: [0, 0, 500, 1000] })).metadata();
    expect([out.width, out.height]).toEqual([500, 500]);
  });

  it('rejects non-finite boxes', async () => {
    await expect(cropToBox({ data: await halves(), box2d: [0, 0, Number.NaN, 10] })).rejects.toThrow();
  });
});
