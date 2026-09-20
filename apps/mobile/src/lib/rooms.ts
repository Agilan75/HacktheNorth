/**
 * The rooms this launch has sent: what home lists under the new-quote form.
 *
 * This is deliberately *not* derived from the session store. The session holds
 * the room being scanned right now; this holds every room already sent. They
 * looked like the same thing while the app could only ever have one room in
 * flight, and they are not: a sweep queued offline lands minutes later, by
 * which time the session may belong to a different room entirely. Deriving the
 * list from the session meant the late sweep had to write its id into the live
 * session to get itself listed, which re-pointed the running scan at the wrong
 * sweep — the second room's camera showing the first room's hazard pins.
 *
 * So the sweep records itself here, directly, with the label and term it was
 * actually sent under, captured before the await. Nothing about the room being
 * scanned now is touched.
 *
 * In memory and this launch only. There is no list-sweeps route — `packages/
 * contracts` has createSweep and getSweep and nothing else — and nothing in
 * this app persists anything, so closing the app empties it. Home says so.
 */

import { useSyncExternalStore } from 'react';

import type { FrameSource, TermMonths } from './session';

export interface RoomEntry {
  readonly sweepId: string;
  /** As sent. Blank is possible: the name is optional and the server defaults it. */
  readonly roomLabel: string;
  readonly termMonths: TermMonths;
  /** How the frames were gathered, or null if it was never recorded. */
  readonly source: FrameSource | null;
}

export interface RoomsStore {
  getRooms(): readonly RoomEntry[];
  subscribe(listener: () => void): () => void;
  /** Newest first. A sweep id already listed is ignored, so this is safe to call twice. */
  record(entry: RoomEntry): void;
  clear(): void;
}

export function createRoomsStore(initial: readonly RoomEntry[] = []): RoomsStore {
  let rooms: readonly RoomEntry[] = initial;
  const listeners = new Set<() => void>();

  const emit = (next: readonly RoomEntry[]): void => {
    if (next === rooms) return;
    rooms = next;
    for (const l of [...listeners]) l();
  };

  return {
    getRooms: () => rooms,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    record(entry) {
      const id = entry.sweepId.trim();
      if (id.length === 0 || rooms.some((r) => r.sweepId === id)) return;
      emit([{ ...entry, sweepId: id, roomLabel: entry.roomLabel.trim() }, ...rooms]);
    },
    clear() {
      emit([]);
    },
  };
}

/** The app-wide list. Screens import this, not `createRoomsStore`. */
export const roomsStore: RoomsStore = createRoomsStore();

/**
 * Subscribes a component to the list.
 *
 * `getRooms` returns the same frozen array until `record` replaces it, so this
 * is a stable snapshot and never loops.
 */
export function useRooms(): readonly RoomEntry[] {
  return useSyncExternalStore(roomsStore.subscribe, roomsStore.getRooms, roomsStore.getRooms);
}
