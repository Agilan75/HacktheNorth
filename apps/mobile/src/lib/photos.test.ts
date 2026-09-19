import { describe, expect, it } from 'vitest';
import type { SweepDto } from '@retrofit/contracts';
import {
  HAZARD_WORDS,
  PHOTO_BEARINGS,
  PHOTO_STEPS,
  REQUIRED_PHOTOS,
  bearingWords,
  commitPhotosToSession,
  cropRect,
  emptySlots,
  filledCount,
  findHazardPhoto,
  fitWithin,
  hazardComponentKey,
  hazardKeyFromId,
  hazardStatus,
  idsFromSourceDetail,
  imageAssets,
  nextEmptySlot,
  placePhotos,
  setSlot,
  slotsStatusText,
  slotsToFrames,
  type PreparedPhoto,
} from './photos';
import { buildCreateRequest, sessionStore } from './session';

const photo = (n: number): PreparedPhoto => ({
  uri: `file:///p${n}.jpg`,
  base64: `QUJD${n}`,
  width: 1600,
  height: 1200,
  capturedAt: `2026-09-19T00:00:0${n}.000Z`,
});

describe('the 3-photo path', () => {
  it('uses bearings 0, 120 and 240 (PRD 11)', () => {
    expect(REQUIRED_PHOTOS).toBe(3);
    expect([...PHOTO_BEARINGS]).toEqual([0, 120, 240]);
    expect(PHOTO_STEPS).toHaveLength(3);
  });

  it('fills empty slots in order and reports overflow', () => {
    const a = placePhotos(emptySlots(), [photo(1), photo(2)]);
    expect(a.overflow).toBe(0);
    expect(filledCount(a.slots)).toBe(2);
    expect(nextEmptySlot(a.slots)).toBe(2);
    const b = placePhotos(a.slots, [photo(3), photo(4), photo(5)]);
    expect(b.overflow).toBe(2);
    expect(b.slots.map((s) => s?.uri)).toEqual(['file:///p1.jpg', 'file:///p2.jpg', 'file:///p3.jpg']);
    expect(nextEmptySlot(b.slots)).toBeNull();
  });

  it('retakes a slot without moving the others', () => {
    const full = placePhotos(emptySlots(), [photo(1), photo(2), photo(3)]).slots;
    const cleared = setSlot(full, 1, null);
    expect(nextEmptySlot(cleared)).toBe(1);
    const refilled = placePhotos(cleared, [photo(9)]).slots;
    expect(refilled.map((s) => s?.uri)).toEqual(['file:///p1.jpg', 'file:///p9.jpg', 'file:///p3.jpg']);
    expect(setSlot(full, 7, null)).toEqual(full);
  });

  it('describes progress in plain words', () => {
    expect(slotsStatusText(emptySlots())).toMatch(/Add 3 photos/);
    expect(slotsStatusText(placePhotos(emptySlots(), [photo(1)]).slots)).toBe('1 of 3 photos added. 2 more to go.');
    expect(slotsStatusText(placePhotos(emptySlots(), [photo(1), photo(2), photo(3)]).slots)).toMatch(/All 3/);
  });

  it('turns three slots into frames with bearings by slot, and refuses gaps', () => {
    expect(slotsToFrames(setSlot(emptySlots(), 1, photo(2)))).toEqual({ ok: false, missing: [0, 2] });
    const out = slotsToFrames(placePhotos(emptySlots(), [photo(1), photo(2), { ...photo(3), base64: 'data:image/jpeg;base64,XYZ' }]).slots);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.frames.map((f) => f.bearingDeg)).toEqual([0, 120, 240]);
    expect(out.frames[2]?.imageBase64).toBe('XYZ');
    expect(out.frames[0]?.capturedAt).toBe(photo(1).capturedAt);
  });

  it('commits to the session as an upload that builds a valid POST /sweeps body', () => {
    sessionStore.reset();
    sessionStore.setRoomLabel('Bedroom');
    const out = commitPhotosToSession(placePhotos(emptySlots(), [photo(1), photo(2), photo(3)]).slots);
    expect(out.ok).toBe(true);
    const s = sessionStore.getState();
    expect(s.source).toBe('upload');
    const req = buildCreateRequest(s);
    expect(req.ok).toBe(true);
    if (req.ok) expect(req.request.frames.map((f) => f.bearingDeg)).toEqual([0, 120, 240]);
    sessionStore.reset();
  });

  it('does not touch the session when a photo is missing', () => {
    sessionStore.reset();
    const out = commitPhotosToSession(placePhotos(emptySlots(), [photo(1)]).slots);
    expect(out.ok).toBe(false);
    expect(sessionStore.getState().frames).toHaveLength(0);
  });

  it('keeps only image assets, in picked order', () => {
    expect(imageAssets({ canceled: true, assets: null })).toEqual([]);
    const picked = imageAssets({
      canceled: false,
      assets: [
        { uri: 'a', width: 1, height: 1, type: 'image' },
        { uri: 'v', width: 1, height: 1, type: 'video' },
        { uri: '', width: 1, height: 1 },
        { uri: 'b', width: 1, height: 1 },
      ],
    });
    expect(picked.map((a) => a.uri)).toEqual(['a', 'b']);
  });

  it('downscales only when the longest edge is too big', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(1200, 900, 1600)).toBeNull();
    expect(fitWithin(0, 900)).toBeNull();
    expect(fitWithin(Number.NaN, 900)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

type Obs = SweepDto['observations'][number];
type Result = NonNullable<SweepDto['result']>;

const obs = (id: string, label: Obs['label'], frameIndex: number, confidence: number, extra: Partial<Obs> = {}): Obs => ({
  id,
  label,
  category: 'other',
  bearingDeg: 0,
  distanceBand: 'mid',
  confidence,
  frameIndex,
  box2d: [100, 200, 300, 400],
  ...extra,
});

const frame = (index: number, dropped = false): SweepDto['frames'][number] => ({
  index,
  bearingDeg: index * 30,
  pitchDeg: null,
  capturedAt: '2026-09-19T00:00:00.000Z',
  quality: 0.9,
  dropped,
  dropReason: dropped ? 'blur' : null,
  imageRef: dropped ? null : `data:image/jpeg;base64,F${index}`,
});

function resultWith(present: Record<string, { value: unknown; sourceDetail: string }[]>, smoke?: number): Result {
  const wrap = (fs: { value: unknown; sourceDetail: string }[]) =>
    fs.map((f) => ({ value: f.value, provenance: { source: 'sweep', sourceDetail: f.sourceDetail } }));
  const hazards = {
    present: Object.fromEntries(Object.entries(present).map(([k, v]) => [k, wrap(v)])),
    ...(smoke === undefined ? {} : { smokeDetectorCount: wrap([{ value: smoke, sourceDetail: 'observations:s1' }]) }),
  };
  return { canonical: { hazards } } as unknown as Result;
}

describe('hazardKeyFromId', () => {
  const observations = [obs('o-candle', 'candle', 0, 0.9), obs('o-curtain', 'curtain', 1, 0.8)];
  it('accepts every spelling the other screens might link with', () => {
    expect(hazardKeyFromId('candle')).toBe('candle');
    expect(hazardKeyFromId('hazards.present.candle')).toBe('candle');
    expect(hazardKeyFromId('hazards.blockedExit')).toBe('blockedExit');
    expect(hazardKeyFromId('hazard.extensionCord')).toBe('extensionCord');
    expect(hazardKeyFromId('hazardPortableHeater')).toBe('portableHeater');
    expect(hazardKeyFromId('hazard_heater_near_combustible')).toBe('heaterNearCombustible');
    expect(hazardKeyFromId('window_ac_unit')).toBe('windowAcUnit');
    expect(hazardKeyFromId('smoke_detection')).toBe('smokeDetectorCount');
    expect(hazardKeyFromId('o-candle', observations)).toBe('candle');
    expect(hazardKeyFromId('o-curtain', observations)).toBe('heaterNearCombustible');
  });
  it('is null for nonsense', () => {
    expect(hazardKeyFromId('')).toBeNull();
    expect(hazardKeyFromId(undefined)).toBeNull();
    expect(hazardKeyFromId('toaster')).toBeNull();
  });
  it('round-trips with the vector component key', () => {
    for (const key of Object.keys(HAZARD_WORDS)) expect(hazardKeyFromId(hazardComponentKey(key))).toBe(key);
    expect(hazardComponentKey('candle')).toBe('hazardCandle');
  });
});

describe('idsFromSourceDetail', () => {
  it('reads the ids after the prefix', () => {
    expect(idsFromSourceDetail('observation:a')).toEqual(['a']);
    expect(idsFromSourceDetail('relate:a+b')).toEqual(['a', 'b']);
    expect(idsFromSourceDetail('observations:a+b+c')).toEqual(['a', 'b', 'c']);
    expect(idsFromSourceDetail('nothing')).toEqual([]);
    expect(idsFromSourceDetail(undefined)).toEqual([]);
  });
});

describe('hazardStatus', () => {
  it('reads the latest value the API holds', () => {
    const r = resultWith({
      candle: [{ value: true, sourceDetail: 'observation:o1' }],
      stove: [
        { value: true, sourceDetail: 'observation:o2' },
        { value: false, sourceDetail: 'verify-fix:2026-09-19T00:00:00Z' },
      ],
      waterHeater: [{ value: false, sourceDetail: 'question:q1' }],
    });
    expect(hazardStatus(r, 'candle')).toBe('present');
    expect(hazardStatus(r, 'stove')).toBe('fixed');
    expect(hazardStatus(r, 'waterHeater')).toBe('absent');
    expect(hazardStatus(r, 'blockedExit')).toBe('unknown');
    expect(hazardStatus(null, 'candle')).toBe('unknown');
  });
  it('treats "no smoke detector" as the hazard', () => {
    expect(hazardStatus(resultWith({}, 0), 'smokeDetectorCount')).toBe('present');
    expect(hazardStatus(resultWith({}, 2), 'smokeDetectorCount')).toBe('absent');
  });
});

describe('findHazardPhoto', () => {
  const frames = [frame(0), frame(1), frame(2, true), frame(3)];

  it('prefers the observation the API cited as evidence', () => {
    const observations = [obs('c1', 'candle', 0, 0.95), obs('c2', 'candle', 1, 0.7)];
    const sweep = { observations, frames, result: resultWith({ candle: [{ value: true, sourceDetail: 'observation:c2' }] }) };
    const p = findHazardPhoto(sweep, 'candle');
    expect(p?.observation.id).toBe('c2');
    expect(p?.imageRef).toBe('data:image/jpeg;base64,F1');
    expect(p?.box2d).toEqual([100, 200, 300, 400]);
  });

  it('falls back to the most confident sighting and skips dropped frames and derived items', () => {
    const observations = [
      obs('a', 'extension_cord', 2, 0.99),
      obs('b', 'extension_cord', 0, 0.6),
      obs('c', 'extension_cord', 3, 0.8),
      obs('d', 'extension_cord', 1, 1, { derived: true }),
    ];
    const p = findHazardPhoto({ observations, frames, result: null }, 'extensionCord');
    expect(p?.observation.id).toBe('c');
  });

  it('shows the heater, not the curtain, for heater-near-combustible', () => {
    const observations = [obs('cur', 'curtain', 0, 0.99), obs('h', 'portable_heater', 1, 0.7)];
    const sweep = {
      observations,
      frames,
      result: resultWith({ heaterNearCombustible: [{ value: true, sourceDetail: 'relate:cur+h' }] }),
    };
    expect(findHazardPhoto(sweep, 'heaterNearCombustible')?.observation.id).toBe('h');
  });

  it('honours an observation named by the route', () => {
    const observations = [obs('c1', 'candle', 0, 0.95), obs('c2', 'candle', 1, 0.7)];
    expect(findHazardPhoto({ observations, frames, result: null }, 'candle', 'c2')?.observation.id).toBe('c2');
  });

  it('returns a null box when the model gave none, and null when no photo exists', () => {
    const noBox = obs('n', 'stove', 0, 0.9, { box2d: undefined });
    expect(findHazardPhoto({ observations: [noBox], frames, result: null }, 'stove')?.box2d).toBeNull();
    expect(findHazardPhoto({ observations: [], frames, result: null }, 'stove')).toBeNull();
    expect(findHazardPhoto({ observations: [obs('x', 'stove', 2, 0.9)], frames, result: null }, 'stove')).toBeNull();
  });
});

describe('cropRect', () => {
  it('maps box_2d [y0,x0,y1,x1] in 0..1000 to pixels', () => {
    expect(cropRect([100, 200, 300, 400], 1000, 500, 0)).toEqual({ originX: 200, originY: 50, width: 200, height: 100 });
  });
  it('pads and clamps to the image', () => {
    expect(cropRect([0, 0, 1000, 1000], 800, 600, 0.2)).toEqual({ originX: 0, originY: 0, width: 800, height: 600 });
    const r = cropRect([100, 100, 200, 200], 1000, 1000, 0.5);
    expect(r).toEqual({ originX: 50, originY: 50, width: 200, height: 200 });
  });
  it('accepts swapped corners and never returns an empty rect', () => {
    expect(cropRect([300, 400, 100, 200], 1000, 500, 0)).toEqual({ originX: 200, originY: 50, width: 200, height: 100 });
    const tiny = cropRect([500, 500, 500, 500], 100, 100, 0);
    expect(tiny?.width).toBeGreaterThanOrEqual(1);
    expect(tiny?.height).toBeGreaterThanOrEqual(1);
  });
  it('is null for unusable sizes or boxes', () => {
    expect(cropRect([0, 0, 10, 10], 0, 100)).toBeNull();
    expect(cropRect([0, 0, Number.NaN, 10], 100, 100)).toBeNull();
  });
});

describe('bearingWords', () => {
  it('uses plain directions, relative to the start', () => {
    expect(bearingWords(0)).toMatch(/straight ahead/);
    expect(bearingWords(350)).toMatch(/straight ahead/);
    expect(bearingWords(120)).toMatch(/right/);
    expect(bearingWords(180)).toMatch(/behind/);
    expect(bearingWords(240)).toMatch(/left/);
    expect(bearingWords(-120)).toMatch(/left/);
    expect(bearingWords(Number.NaN)).toBe('in the room');
  });
});
