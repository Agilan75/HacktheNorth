/**
 * The in-progress sweep session: room label, term, frames with bearings, an
 * optional submission to attach to, and the sweep id once the API accepted it.
 *
 * A tiny external store (no library), shared by /new, /sweep, /analyzing and
 * later screens. Pure apart from the `useSession` hook, which needs only
 * `react` — never `react-native` — so the store runs under vitest in node.
 *
 * The store holds what the user gave us. It never computes a verdict, price or
 * hazard: those come back from the API.
 */

import { useSyncExternalStore } from 'react';
import type { SweepCreateRequestDto } from '@retrofit/contracts';

import { MAX_FRAMES } from './capture';
import { normalizeDeg } from './heading';

export type TermMonths = 4 | 8 | 12;
export const TERM_OPTIONS: readonly TermMonths[] = [4, 8, 12];
export const DEFAULT_TERM: TermMonths = 12;
export const ROOM_LABEL_MAX = 120;

/** How the frames were gathered. The upload path is a first-class peer of the sweep. */
export type FrameSource = 'sweep' | 'upload';

export interface SessionFrame {
  /** Relative bearing, 0 = sweep start (or first picked photo). */
  readonly bearingDeg: number;
  readonly pitchDeg?: number;
  /** ISO 8601. */
  readonly capturedAt: string;
  /** base64 JPEG/PNG, no `data:` prefix. */
  readonly imageBase64: string;
  /** Local file URI for thumbnails, when known. */
  readonly uri?: string;
}

export interface SessionState {
  /** Blank is normal: nothing asks for a name, and the server defaults it. */
  readonly roomLabel: string;
  readonly termMonths: TermMonths;
  readonly submissionId: string | null;
  readonly source: FrameSource | null;
  readonly frames: readonly SessionFrame[];
  /** Replacement value priced during the sweep, USD. Null before a sweep ends. */
  readonly contentsEstimateUsd: number | null;
  /** Set once POST /sweeps returned. */
  readonly sweepId: string | null;
}

export const initialSession: SessionState = Object.freeze({
  roomLabel: '',
  termMonths: DEFAULT_TERM,
  submissionId: null,
  source: null,
  frames: Object.freeze([]) as readonly SessionFrame[],
  contentsEstimateUsd: null,
  sweepId: null,
}) as SessionState;

export function isTermMonths(v: unknown): v is TermMonths {
  return v === 4 || v === 8 || v === 12;
}

/** Strips a `data:image/...;base64,` prefix if the camera or picker added one. */
export function stripDataUrl(b64: string): string {
  const i = b64.indexOf('base64,');
  return b64.startsWith('data:') && i >= 0 ? b64.slice(i + 'base64,'.length) : b64;
}

function cleanFrame(f: SessionFrame): SessionFrame {
  const bearing = normalizeDeg(f.bearingDeg);
  return {
    ...f,
    bearingDeg: Number.isFinite(bearing) ? bearing : 0,
    imageBase64: stripDataUrl(f.imageBase64),
  };
}

/**
 * A blank room name is not a problem any more: the viewfinder is the first
 * screen, so nothing asks for one and the server defaults it.
 */
export type SessionProblem = 'room-label-too-long' | 'no-frames' | 'too-many-frames';

/** Plain-language messages for each problem, for the screen to show and announce. */
export const SESSION_PROBLEM_TEXT: Readonly<Record<SessionProblem, string>> = {
  'room-label-too-long': `Room name over ${ROOM_LABEL_MAX} characters.`,
  'no-frames': 'No photos yet. Scan the room, or pick photos.',
  'too-many-frames': `At most ${MAX_FRAMES} photos.`,
};

export function sessionProblems(s: SessionState): SessionProblem[] {
  const problems: SessionProblem[] = [];
  if (s.roomLabel.trim().length > ROOM_LABEL_MAX) problems.push('room-label-too-long');
  if (s.frames.length === 0) problems.push('no-frames');
  if (s.frames.length > MAX_FRAMES) problems.push('too-many-frames');
  return problems;
}

export type BuildRequestResult =
  | { readonly ok: true; readonly request: SweepCreateRequestDto }
  | { readonly ok: false; readonly problems: readonly SessionProblem[] };

/** The POST /sweeps body, or the reasons it cannot be sent yet. */
export function buildCreateRequest(s: SessionState): BuildRequestResult {
  const problems = sessionProblems(s);
  if (problems.length > 0) return { ok: false, problems };
  const submissionId = s.submissionId?.trim();
  const label = s.roomLabel.trim();
  const contents = s.contentsEstimateUsd;
  const request: SweepCreateRequestDto = {
    // Both omitted rather than guessed: the server holds the one default.
    ...(label.length > 0 ? { roomLabel: label } : {}),
    termMonths: s.termMonths,
    ...(submissionId ? { submissionId } : {}),
    ...(contents !== null && Number.isFinite(contents) && contents > 0
      ? { contentsEstimateUsd: Math.round(contents) }
      : {}),
    frames: s.frames.map((f) => ({
      bearingDeg: f.bearingDeg,
      ...(f.pitchDeg !== undefined && Number.isFinite(f.pitchDeg)
        ? { pitchDeg: Math.max(-90, Math.min(90, f.pitchDeg)) }
        : {}),
      capturedAt: f.capturedAt,
      imageBase64: f.imageBase64,
    })),
  };
  return { ok: true, request };
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

export interface SessionStore {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  setRoomLabel(label: string): void;
  setTerm(term: TermMonths): void;
  /** Null or blank detaches. */
  attachSubmission(id: string | null): void;
  /** Appends one sweep frame. Ignored past MAX_FRAMES. Switches source to 'sweep'. */
  addFrame(frame: SessionFrame): void;
  /** Replaces all frames (the upload path, or a finished sweep). Truncates to MAX_FRAMES. */
  setFrames(frames: readonly SessionFrame[], source: FrameSource): void;
  /** The replacement value priced during the sweep. Null clears it. */
  setContentsEstimate(usd: number | null): void;
  clearFrames(): void;
  setSweepId(id: string | null): void;
  /** Back to a blank session. */
  reset(): void;
}

export function createSessionStore(initial: SessionState = initialSession): SessionStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const set = (next: SessionState) => {
    if (next === state) return;
    state = next;
    for (const l of [...listeners]) l();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRoomLabel(label) {
      set({ ...state, roomLabel: label });
    },
    setTerm(term) {
      if (!isTermMonths(term)) throw new RangeError(`term must be 4, 8 or 12 months, got ${String(term)}`);
      set({ ...state, termMonths: term });
    },
    attachSubmission(id) {
      const clean = id?.trim();
      set({ ...state, submissionId: clean ? clean : null });
    },
    addFrame(frame) {
      // Switching from uploaded photos to a sweep starts the frames over.
      const frames = state.source === 'upload' ? [] : state.frames;
      if (frames.length >= MAX_FRAMES) return;
      set({ ...state, source: 'sweep', frames: [...frames, cleanFrame(frame)] });
    },
    setFrames(frames, source) {
      set({ ...state, source, frames: frames.slice(0, MAX_FRAMES).map(cleanFrame) });
    },
    setContentsEstimate(usd) {
      const clean = usd !== null && Number.isFinite(usd) && usd > 0 ? usd : null;
      set({ ...state, contentsEstimateUsd: clean });
    },
    clearFrames() {
      set({ ...state, source: null, frames: [], contentsEstimateUsd: null });
    },
    setSweepId(id) {
      set({ ...state, sweepId: id });
    },
    reset() {
      set(initialSession);
    },
  };
}

/** The app-wide session. Screens import this, not `createSessionStore`. */
export const sessionStore: SessionStore = createSessionStore();

/** Subscribes a component to the session (or to one slice of it). */
export function useSession(): SessionState;
export function useSession<T>(select: (s: SessionState) => T): T;
export function useSession<T>(select?: (s: SessionState) => T): T | SessionState {
  const s = useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);
  return select ? select(s) : s;
}
