/**
 * Photos. Unit M9.
 *
 * Two jobs, both about still photos rather than the live sweep:
 *
 * 1. **The 3-photo path (PRD §11).** Anyone who cannot do a camera sweep,
 *    because of a motor or vision impairment, a broken compass, the iOS
 *    Simulator, or just preference, picks three photos (library or camera).
 *    They get bearings 0°, 120° and 240° and go through exactly the same
 *    `POST /sweeps` pipeline as a sweep. It is a first-class path, not a
 *    hidden fallback.
 * 2. **The hazard photo (PRD §9.3 step 6).** Which frame, and which `box_2d`
 *    inside it, shows a given hazard, so `/hazard/[id]` can show a close-up.
 *
 * Everything above the "Native" section is pure and runs under vitest in node.
 * The native half loads `expo-image-picker` and `expo-image-manipulator` with a
 * dynamic `import()` inside the functions that need them, so importing this
 * module never pulls React Native into a node test.
 *
 * Nothing here computes a verdict, a price or a hazard. Hazards are read from
 * what the API returned; this module only decides which photo to show.
 */
import type { ImagePickerAsset, ImagePickerResult } from 'expo-image-picker';
import type { SweepDto } from '@retrofit/contracts';

import { uploadBearings } from './capture';
import { sessionStore, type SessionFrame } from './session';

/* -------------------------------------------------------------------------- */
/* The 3-photo path: pure                                                     */
/* -------------------------------------------------------------------------- */

export const REQUIRED_PHOTOS = 3;

/** 0, 120, 240: the PRD §11 bearings, from the same helper the session uses. */
export const PHOTO_BEARINGS: readonly number[] = Object.freeze(uploadBearings(REQUIRED_PHOTOS));

/** Longest edge sent to the API. Big enough for the vision call, small enough for venue Wi-Fi. */
export const MAX_PHOTO_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.7;

/**
 * Plain-language instructions, one per photo. No compass words, no degrees:
 * "a third of the way round" is what 120° means to a person standing in a room.
 */
export const PHOTO_STEPS: readonly { readonly title: string; readonly hint: string }[] = Object.freeze([
  {
    title: 'Photo 1 of 3',
    hint: 'Stand near the door and take a photo of the wall in front of you.',
  },
  {
    title: 'Photo 2 of 3',
    hint: 'Turn about a third of the way round to your right and take the next wall.',
  },
  {
    title: 'Photo 3 of 3',
    hint: 'Turn another third to your right, so you have now seen the whole room.',
  },
]);

/** A photo ready to send: already resized, base64 without a `data:` prefix. */
export interface PreparedPhoto {
  /** Local file URI for the thumbnail. */
  readonly uri: string;
  readonly base64: string;
  readonly width: number;
  readonly height: number;
  /** ISO 8601. */
  readonly capturedAt: string;
}

/** Exactly REQUIRED_PHOTOS slots; `null` is an empty slot. Slot i gets PHOTO_BEARINGS[i]. */
export type PhotoSlots = readonly (PreparedPhoto | null)[];

export function emptySlots(): PhotoSlots {
  return Array.from({ length: REQUIRED_PHOTOS }, () => null);
}

/** Coerces anything to exactly REQUIRED_PHOTOS slots. */
function normalizeSlots(slots: PhotoSlots): (PreparedPhoto | null)[] {
  return Array.from({ length: REQUIRED_PHOTOS }, (_, i) => slots[i] ?? null);
}

/**
 * Drops photos into the empty slots in order. Photos that do not fit come back
 * in `overflow` so the screen can say "we used the first three".
 */
export function placePhotos(
  slots: PhotoSlots,
  photos: readonly PreparedPhoto[],
): { readonly slots: PhotoSlots; readonly overflow: number } {
  const next = normalizeSlots(slots);
  let used = 0;
  for (let i = 0; i < next.length && used < photos.length; i += 1) {
    if (next[i] === null) {
      next[i] = photos[used] ?? null;
      used += 1;
    }
  }
  return { slots: next, overflow: photos.length - used };
}

/** Puts one photo in a specific slot (retake), replacing what was there. */
export function setSlot(slots: PhotoSlots, index: number, photo: PreparedPhoto | null): PhotoSlots {
  const next = normalizeSlots(slots);
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next;
  next[index] = photo;
  return next;
}

export function filledCount(slots: PhotoSlots): number {
  return normalizeSlots(slots).filter((s) => s !== null).length;
}

/** Index of the first empty slot, or null when all three are filled. */
export function nextEmptySlot(slots: PhotoSlots): number | null {
  const i = normalizeSlots(slots).indexOf(null);
  return i < 0 ? null : i;
}

/** One sentence for the screen and VoiceOver: how many photos, how many to go. */
export function slotsStatusText(slots: PhotoSlots): string {
  const n = filledCount(slots);
  if (n === 0) return `Add ${REQUIRED_PHOTOS} photos of the room, one for each part of it.`;
  if (n >= REQUIRED_PHOTOS) return `All ${REQUIRED_PHOTOS} photos added. You can get your quote.`;
  const left = REQUIRED_PHOTOS - n;
  return `${n} of ${REQUIRED_PHOTOS} photos added. ${left} more to go.`;
}

export type SlotsToFramesResult =
  | { readonly ok: true; readonly frames: readonly SessionFrame[] }
  | { readonly ok: false; readonly missing: readonly number[] };

/** Frames for the session (and so for POST /sweeps), with bearings 0/120/240 by slot. */
export function slotsToFrames(slots: PhotoSlots): SlotsToFramesResult {
  const full = normalizeSlots(slots);
  const missing = full.flatMap((s, i) => (s === null ? [i] : []));
  if (missing.length > 0) return { ok: false, missing };
  const frames = full.map((photo, i): SessionFrame => {
    const p = photo as PreparedPhoto;
    return {
      bearingDeg: PHOTO_BEARINGS[i] ?? 0,
      capturedAt: p.capturedAt,
      imageBase64: stripDataPrefix(p.base64),
      uri: p.uri,
    };
  });
  return { ok: true, frames };
}

function stripDataPrefix(b64: string): string {
  const i = b64.indexOf('base64,');
  return b64.startsWith('data:') && i >= 0 ? b64.slice(i + 'base64,'.length) : b64;
}

/** The subset of a picker asset this module reads. */
export type PickedAsset = Pick<ImagePickerAsset, 'uri' | 'width' | 'height'> & {
  readonly type?: ImagePickerAsset['type'];
};

/** Usable image assets from a picker result, in the order the user picked them. */
export function imageAssets(result: Pick<ImagePickerResult, 'canceled' | 'assets'>): PickedAsset[] {
  if (result.canceled || !Array.isArray(result.assets)) return [];
  return result.assets.filter(
    (a) =>
      typeof a.uri === 'string' &&
      a.uri.length > 0 &&
      (a.type === undefined || a.type === null || a.type === 'image' || a.type === 'livePhoto'),
  );
}

/**
 * Size to downscale to so the longest edge is at most `maxEdge`, keeping the
 * aspect ratio. Null when the image is already small enough (or its size is
 * unknown, in which case the native side resizes by width as a fallback).
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_PHOTO_EDGE,
): { readonly width: number; readonly height: number } | null {
  if (!(width > 0) || !(height > 0) || !(maxEdge > 0)) return null;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return null;
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/* -------------------------------------------------------------------------- */
/* Hazard photos: pure                                                        */
/* -------------------------------------------------------------------------- */

type SweepObservation = SweepDto['observations'][number];
type SweepFrame = SweepDto['frames'][number];
type EngineResult = NonNullable<SweepDto['result']>;
type Box2d = readonly [number, number, number, number];

/** Plain-language words for each tenant hazard key (keys match `hazards.*`). */
export interface HazardWords {
  /** Short name, e.g. "Open-flame candle". */
  readonly name: string;
  /** Why an insurer cares, in one or two plain sentences. */
  readonly why: string;
  /** What to do about it, when the API sends no fix hint of its own. */
  readonly fix: string;
}

export const HAZARD_WORDS: Readonly<Record<string, HazardWords>> = Object.freeze({
  portableHeater: {
    name: 'Space heater',
    why: 'Portable heaters start more home fires than any other heating.',
    fix: 'Keep it a metre from anything that burns.',
  },
  heaterNearCombustible: {
    name: 'Heater near fabric',
    why: 'A heater beside curtains or bedding can light them untouched.',
    fix: 'Move the heater away from curtains, fabric and bedding.',
  },
  extensionCord: {
    name: 'Extension cord',
    why: 'Cords in permanent use overheat, especially under a rug.',
    fix: 'Use a wall outlet. Put the cord away.',
  },
  powerBarOverload: {
    name: 'Overloaded power bar',
    why: 'A full bar draws more than its wiring is rated for.',
    fix: 'Spread the plugs across more than one outlet.',
  },
  candle: {
    name: 'Open flame',
    why: 'An unattended flame catches what is next to it.',
    fix: 'Use battery candles.',
  },
  stove: {
    name: 'Cooking appliance',
    why: 'Cooking is the most common cause of home fires.',
    fix: 'Keep the area clear. Never leave it on unattended.',
  },
  blockedExit: {
    name: 'Blocked exit',
    why: 'A fire needs a clear way out, through a door or a window.',
    fix: 'Clear the path to the door or window.',
  },
  windowAcUnit: {
    name: 'Window AC',
    why: 'Window units leak water into the wall and the floor.',
    fix: 'Check the drain runs outside and the seal is tight.',
  },
  waterHeater: {
    name: 'Water heater',
    why: 'Tanks leak and burst, into your unit and the one below.',
    fix: 'Check for leaks. Keep the area clear.',
  },
  highValueContents: {
    name: 'High-value contents',
    why: 'Jewellery, cameras and instruments can exceed a standard limit.',
    fix: 'List the dearest items so they are covered in full.',
  },
  smokeDetectorCount: {
    name: 'No smoke detector',
    why: 'A working detector is the earliest warning there is.',
    fix: 'Fit one on the ceiling, then photograph it.',
  },
});

/** Object labels whose sighting supports each hazard key (mirrors the API's mapping). */
const LABEL_TO_KEYS: Readonly<Record<string, readonly string[]>> = {
  portable_heater: ['portableHeater', 'heaterNearCombustible'],
  curtain: ['heaterNearCombustible'],
  fabric: ['heaterNearCombustible'],
  bedding: ['heaterNearCombustible'],
  extension_cord: ['extensionCord'],
  power_bar: ['powerBarOverload'],
  candle: ['candle'],
  stove: ['stove'],
  blocked_exit: ['blockedExit'],
  window_ac_unit: ['windowAcUnit'],
  water_heater: ['waterHeater'],
  bike: ['highValueContents'],
  jewelry: ['highValueContents'],
  camera: ['highValueContents'],
  laptop: ['highValueContents'],
  tv: ['highValueContents'],
  instrument: ['highValueContents'],
  smoke_detector: ['smokeDetectorCount'],
};

/** Labels to prefer as the photo for a key (the heater itself, not the curtain). */
const PRIMARY_LABEL: Readonly<Record<string, string>> = {
  heaterNearCombustible: 'portable_heater',
  portableHeater: 'portable_heater',
};

/** `candle` -> `hazardCandle`: the tenant vector component key. */
export function hazardComponentKey(hazardKey: string): string {
  return hazardKey === 'smokeDetectorCount'
    ? hazardKey
    : `hazard${hazardKey.charAt(0).toUpperCase()}${hazardKey.slice(1)}`;
}

function camelFromSnake(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Turns whatever `/hazard/[id]` was given into a hazard key. Accepts the key
 * itself (`candle`), a canonical path (`hazards.present.candle`,
 * `hazards.candle`), a vector component key (`hazardCandle`), a price factor
 * name (`hazard.candle`), a rule factor (`hazard_candle`), or an observation id
 * from the sweep. Null when it is none of those.
 */
export function hazardKeyFromId(
  rawId: string | null | undefined,
  observations: readonly SweepObservation[] = [],
): string | null {
  const id = (rawId ?? '').trim();
  if (id.length === 0) return null;
  if (HAZARD_WORDS[id] !== undefined) return id;

  const obs = observations.find((o) => o.id === id);
  if (obs !== undefined) return LABEL_TO_KEYS[obs.label]?.[0] ?? null;

  const candidates: string[] = [];
  const dotted = id.match(/^hazards?\.(?:present\.)?(.+)$/);
  if (dotted?.[1]) candidates.push(dotted[1]);
  const snake = id.match(/^hazard_(.+)$/);
  if (snake?.[1]) candidates.push(camelFromSnake(snake[1]));
  const component = id.match(/^hazard([A-Z].*)$/);
  if (component?.[1]) candidates.push(component[1].charAt(0).toLowerCase() + component[1].slice(1));
  if (id === 'smoke_detection' || id === 'smokeDetector') candidates.push('smokeDetectorCount');
  candidates.push(camelFromSnake(id));

  return candidates.find((c) => HAZARD_WORDS[c] !== undefined) ?? null;
}

/** Observation ids named in `sourceDetail`s like `observation:a`, `relate:a+b`, `observations:a+b`. */
export function idsFromSourceDetail(detail: string | null | undefined): string[] {
  if (typeof detail !== 'string') return [];
  const i = detail.indexOf(':');
  if (i < 0) return [];
  return detail
    .slice(i + 1)
    .split('+')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type HazardField = { readonly value: unknown; readonly provenance: { readonly source: string; readonly sourceDetail?: string } };

/** The `hazards.present.<key>` slot (or the smoke detector count) from the API's result. */
export function hazardFields(result: EngineResult | null | undefined, hazardKey: string): readonly HazardField[] {
  const hazards = result?.canonical?.hazards;
  if (hazards === undefined) return [];
  if (hazardKey === 'smokeDetectorCount') return (hazards.smokeDetectorCount ?? []) as readonly HazardField[];
  const present = hazards.present as Readonly<Record<string, readonly HazardField[] | undefined>>;
  return present[hazardKey] ?? [];
}

/**
 * What the API currently says about this hazard, read from its latest value:
 * - `present`: seen / reported
 * - `fixed`: a verify-fix photo showed it gone
 * - `absent`: recorded as not there
 * - `unknown`: the API has no value for it
 */
export type HazardStatus = 'present' | 'fixed' | 'absent' | 'unknown';

export function hazardStatus(result: EngineResult | null | undefined, hazardKey: string): HazardStatus {
  const fields = hazardFields(result, hazardKey);
  const last = fields[fields.length - 1];
  if (last === undefined) return 'unknown';
  if (hazardKey === 'smokeDetectorCount') {
    // The "hazard" is having none.
    return typeof last.value === 'number' && last.value > 0 ? 'absent' : 'present';
  }
  const isPresent = last.value === true || (typeof last.value === 'number' && last.value > 0);
  if (isPresent) return 'present';
  return (last.provenance.sourceDetail ?? '').startsWith('verify-fix') ? 'fixed' : 'absent';
}

export interface HazardPhoto {
  readonly observation: SweepObservation;
  readonly frame: SweepFrame;
  /** Data URL (or path) of the whole frame, from the API. */
  readonly imageRef: string;
  /** The model`s `box_2d` `[y0, x0, y1, x1]` in 0..1000, when it gave one. */
  readonly box2d: Box2d | null;
}

/**
 * The best photo of a hazard: an observation that supports it, whose frame the
 * API still holds. Preference order: the observation the route named, then the
 * ones the API cited as evidence, then any sighting of a matching object; within
 * each, the primary object (the heater, not the curtain), a box to crop to, and
 * higher confidence. Pair-rule products (`derived`) are never used.
 */
export function findHazardPhoto(
  sweep: Pick<SweepDto, 'observations' | 'frames' | 'result'>,
  hazardKey: string,
  preferredObservationId?: string | null,
): HazardPhoto | null {
  const cited = new Set(hazardFields(sweep.result, hazardKey).flatMap((f) => idsFromSourceDetail(f.provenance.sourceDetail)));
  const primary = PRIMARY_LABEL[hazardKey];

  const frameFor = (o: SweepObservation): SweepFrame | undefined =>
    sweep.frames.find((f) => f.index === o.frameIndex && !f.dropped && typeof f.imageRef === 'string' && f.imageRef.length > 0);

  const candidates = sweep.observations.filter(
    (o) =>
      o.derived !== true &&
      (o.id === preferredObservationId || cited.has(o.id) || (LABEL_TO_KEYS[o.label] ?? []).includes(hazardKey)) &&
      frameFor(o) !== undefined,
  );
  if (candidates.length === 0) return null;

  const rank = (o: SweepObservation): number[] => [
    o.id === preferredObservationId ? 1 : 0,
    cited.has(o.id) ? 1 : 0,
    primary !== undefined && o.label === primary ? 1 : 0,
    validBox(o.box2d) ? 1 : 0,
    Number.isFinite(o.confidence) ? o.confidence : 0,
  ];
  const better = (a: SweepObservation, b: SweepObservation): SweepObservation => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) {
      if ((rb[i] ?? 0) > (ra[i] ?? 0)) return b;
      if ((rb[i] ?? 0) < (ra[i] ?? 0)) return a;
    }
    return a;
  };
  const best = candidates.reduce(better);
  const frame = frameFor(best) as SweepFrame;
  return {
    observation: best,
    frame,
    imageRef: frame.imageRef as string,
    box2d: validBox(best.box2d) ? best.box2d : null,
  };
}

function validBox(box: SweepObservation['box2d']): box is Box2d {
  return Array.isArray(box) && box.length === 4 && box.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Pixel crop rectangle for a `box_2d` on a `width` x `height` image, padded by
 * `padding` (a share of the box on each side) and clamped to the image. Same
 * geometry as the API's `cropToBox`. Null when the image size is unusable.
 */
export function cropRect(
  box2d: Box2d,
  width: number,
  height: number,
  padding = 0.15,
): { readonly originX: number; readonly originY: number; readonly width: number; readonly height: number } | null {
  if (!(width >= 1) || !(height >= 1) || !validBox(box2d)) return null;
  const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
  const [a, b, c, d] = box2d.map((v) => clamp(v, 0, 1000) / 1000) as [number, number, number, number];
  const pad = Math.max(0, padding);
  const py = (Math.max(a, c) - Math.min(a, c)) * pad;
  const px = (Math.max(b, d) - Math.min(b, d)) * pad;
  const y0 = clamp(Math.min(a, c) - py, 0, 1);
  const y1 = clamp(Math.max(a, c) + py, 0, 1);
  const x0 = clamp(Math.min(b, d) - px, 0, 1);
  const x1 = clamp(Math.max(b, d) + px, 0, 1);
  const EPS = 1e-6;
  const left = clamp(Math.floor(x0 * width + EPS), 0, width - 1);
  const top = clamp(Math.floor(y0 * height + EPS), 0, height - 1);
  const right = clamp(Math.ceil(x1 * width - EPS), left + 1, width);
  const bottom = clamp(Math.ceil(y1 * height - EPS), top + 1, height);
  return { originX: left, originY: top, width: right - left, height: bottom - top };
}

/** "straight ahead" / "to your right" … for a bearing relative to the sweep start. */
export function bearingWords(bearingDeg: number): string {
  if (!Number.isFinite(bearingDeg)) return 'in the room';
  const b = ((bearingDeg % 360) + 360) % 360;
  if (b < 30 || b >= 330) return 'straight ahead of where you started';
  if (b < 150) return 'to the right of where you started';
  if (b < 210) return 'behind where you started';
  return 'to the left of where you started';
}

/* -------------------------------------------------------------------------- */
/* Native: picker and resize, not run in node                                 */
/* -------------------------------------------------------------------------- */

export type PickOutcome =
  | { readonly status: 'picked'; readonly photos: readonly PreparedPhoto[]; readonly skipped: number }
  | { readonly status: 'cancelled' }
  | { readonly status: 'denied'; readonly message: string }
  | { readonly status: 'failed'; readonly message: string };

const PHOTO_FAILED = 'We could not use that photo. Please try again or pick a different one.';

/** Resizes to MAX_PHOTO_EDGE and re-encodes as JPEG with base64. */
export async function preparePhoto(asset: PickedAsset, capturedAt: string = new Date().toISOString()): Promise<PreparedPhoto> {
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const ctx = ImageManipulator.manipulate(asset.uri);
  const target = fitWithin(asset.width, asset.height);
  if (target !== null) ctx.resize({ width: target.width, height: target.height });
  else if (!(asset.width > 0) || !(asset.height > 0)) ctx.resize({ width: MAX_PHOTO_EDGE });
  const ref = await ctx.renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_JPEG_QUALITY, base64: true });
  if (typeof saved.base64 !== 'string' || saved.base64.length === 0) throw new Error('no image data');
  return { uri: saved.uri, base64: saved.base64, width: saved.width, height: saved.height, capturedAt };
}

async function prepareAll(assets: readonly PickedAsset[]): Promise<PickOutcome> {
  const photos: PreparedPhoto[] = [];
  let skipped = 0;
  for (const asset of assets) {
    try {
      photos.push(await preparePhoto(asset));
    } catch {
      skipped += 1;
    }
  }
  if (photos.length === 0) return { status: 'failed', message: PHOTO_FAILED };
  return { status: 'picked', photos, skipped };
}

/**
 * Opens the photo library for up to `limit` photos (default: 3), in the order
 * the user taps them. iOS's picker needs no library permission.
 */
export async function pickPhotosFromLibrary(limit: number = REQUIRED_PHOTOS): Promise<PickOutcome> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const n = Math.max(1, Math.min(REQUIRED_PHOTOS, Math.floor(limit)));
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: n > 1,
      selectionLimit: n,
      orderedSelection: true,
      quality: 1,
      exif: false,
    });
    if (result.canceled) return { status: 'cancelled' };
    return await prepareAll(imageAssets(result).slice(0, n));
  } catch {
    return { status: 'failed', message: 'The photo library did not open. Please try again.' };
  }
}

/** Takes one photo with the system camera (big shutter, VoiceOver-friendly). */
export async function takePhotoWithCamera(): Promise<PickOutcome> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return {
        status: 'denied',
        message: 'Camera access is off. You can pick photos from your library instead, or turn on camera access in Settings.',
      };
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (result.canceled) return { status: 'cancelled' };
    return await prepareAll(imageAssets(result).slice(0, 1));
  } catch {
    return { status: 'failed', message: 'The camera did not open. You can pick photos from your library instead.' };
  }
}

/**
 * Hands three filled slots to the session as the upload path. The caller then
 * sends the session the same way a finished sweep is sent.
 */
export function commitPhotosToSession(slots: PhotoSlots): SlotsToFramesResult {
  const out = slotsToFrames(slots);
  if (out.ok) sessionStore.setFrames(out.frames, 'upload');
  return out;
}
