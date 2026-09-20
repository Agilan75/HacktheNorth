/**
 * Live pricing during a sweep. Every captured frame is sent to
 * POST /price/identify the moment it is taken; each item found shows its
 * ballpark price at once, and a branded item starts a background
 * POST /price/lookup while the user keeps turning. `finish()` hands back the
 * report within `REPORT_DEADLINE_MS` no matter what is still in flight.
 *
 * Pure: no React Native import. Subscribe with `useSyncExternalStore`.
 */
import type { ApiClient, LiveItem, LivePriceSource } from './api';

export const REPORT_DEADLINE_MS = 5_000;
/** Frames are dropped, not queued, past this: a newer frame is always on its way. */
const MAX_IDENTIFY_IN_FLIGHT = 3;
const MAX_LOOKUP_IN_FLIGHT = 4;

export type LiveStatus = 'ballpark' | 'searching' | 'sourced' | 'no_source';

export interface LiveEntry {
  readonly item: LiveItem;
  readonly status: LiveStatus;
  /** What the chip shows: the sourced price once there is one, else the ballpark. */
  readonly price: number;
  readonly sources: readonly LivePriceSource[];
  readonly firstSeenMs: number;
  /**
   * Bearing of the frame the item was first seen in, degrees clockwise from
   * the sweep start. Null when the caller did not pass one. It is what anchors
   * the item's tag to the room rather than to the screen.
   */
  readonly bearingDeg: number | null;
}

export interface LiveSnapshot {
  readonly entries: readonly LiveEntry[];
  readonly total: number;
  readonly identifying: number;
  readonly searching: number;
}

export interface LiveReport extends LiveSnapshot {
  readonly sourcedCount: number;
  /** Lookups still running when the deadline hit; those rows keep their ballpark. */
  readonly unfinished: number;
}

export interface LivePricer {
  /** `bearingDeg` anchors whatever is found to the direction the frame faced. */
  onFrame(imageBase64: string, bearingDeg?: number): void;
  snapshot(): LiveSnapshot;
  subscribe(listener: () => void): () => void;
  finish(deadlineMs?: number): Promise<LiveReport>;
  reset(): void;
}

const EMPTY: LiveSnapshot = { entries: [], total: 0, identifying: 0, searching: 0 };

const branded = (i: LiveItem): boolean => i.brand !== null || i.model !== null;

export function createLivePricer(
  api: Pick<ApiClient, 'identifyItems' | 'lookupPrice'>,
  nowMs: () => number = Date.now,
): LivePricer {
  let entries = new Map<string, LiveEntry>();
  let identifying = 0;
  let generation = 0;
  const lookupQueue: LiveItem[] = [];
  let lookupsRunning = 0;
  const pending = new Set<Promise<unknown>>();
  const listeners = new Set<() => void>();
  let snap: LiveSnapshot = EMPTY;

  function publish(): void {
    const list = [...entries.values()].sort((a, b) => a.firstSeenMs - b.firstSeenMs);
    snap = {
      entries: list,
      total: list.reduce((sum, e) => sum + e.price, 0),
      identifying,
      searching: list.filter((e) => e.status === 'searching').length,
    };
    for (const l of listeners) l();
  }

  function track<T>(p: Promise<T>): Promise<T> {
    pending.add(p);
    const done = (): void => {
      pending.delete(p);
    };
    p.then(done, done);
    return p;
  }

  function pumpLookups(): void {
    const gen = generation;
    while (lookupsRunning < MAX_LOOKUP_IN_FLIGHT && lookupQueue.length > 0) {
      const item = lookupQueue.shift()!;
      lookupsRunning += 1;
      const run = api
        .lookupPrice({ label: item.label, name: item.name, brand: item.brand, model: item.model })
        .then(
          (r) => {
            const e = entries.get(item.key);
            if (gen !== generation || e === undefined) return;
            entries.set(item.key, {
              ...e,
              status: r.price === null ? 'no_source' : 'sourced',
              price: r.price ?? e.item.tablePrice,
              sources: r.sources,
            });
          },
          () => {
            const e = entries.get(item.key);
            if (gen !== generation || e === undefined) return;
            entries.set(item.key, { ...e, status: 'no_source' });
          },
        )
        .finally(() => {
          lookupsRunning -= 1;
          if (gen === generation) {
            publish();
            pumpLookups();
          }
        });
      void track(run);
    }
  }

  function add(item: LiveItem, bearingDeg: number | null): void {
    if (entries.has(item.key)) return;
    // A brand read on a later frame upgrades the unbranded sighting of the same
    // kind of item, and inherits where that sighting was.
    let inheritedBearing: number | null = null;
    if (branded(item)) {
      const plainKey = `${item.label}||`;
      const plain = entries.get(plainKey);
      if (plain !== undefined) {
        inheritedBearing = plain.bearingDeg;
        entries.delete(plainKey);
      }
    } else if ([...entries.values()].some((e) => e.item.label === item.label && branded(e.item))) {
      return;
    }
    entries.set(item.key, {
      item,
      status: branded(item) ? 'searching' : 'ballpark',
      price: item.tablePrice,
      sources: [],
      firstSeenMs: nowMs(),
      bearingDeg: bearingDeg ?? inheritedBearing,
    });
    if (branded(item)) lookupQueue.push(item);
  }

  return {
    onFrame(imageBase64, bearingDeg) {
      if (identifying >= MAX_IDENTIFY_IN_FLIGHT) return;
      const gen = generation;
      const at = typeof bearingDeg === 'number' && Number.isFinite(bearingDeg) ? bearingDeg : null;
      identifying += 1;
      publish();
      const run = api
        .identifyItems(imageBase64)
        .then(
          (r) => {
            if (gen === generation) for (const item of r.items) add(item, at);
          },
          () => undefined,
        )
        .finally(() => {
          if (gen !== generation) return;
          identifying -= 1;
          publish();
          pumpLookups();
        });
      void track(run);
    },

    snapshot: () => snap,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async finish(deadlineMs = REPORT_DEADLINE_MS) {
      const deadline = nowMs() + deadlineMs;
      // Lookups can be started by identifies that land during the wait, so loop until quiet or out of time.
      while (pending.size > 0) {
        const left = deadline - nowMs();
        if (left <= 0) break;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.allSettled([...pending]),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, left);
          }),
        ]);
        clearTimeout(timer);
      }
      const s = snap;
      return {
        ...s,
        sourcedCount: s.entries.filter((e) => e.status === 'sourced').length,
        unfinished: s.entries.filter((e) => e.status === 'searching').length,
      };
    },

    reset() {
      generation += 1;
      entries = new Map();
      identifying = 0;
      lookupQueue.length = 0;
      lookupsRunning = 0;
      pending.clear();
      snap = EMPTY;
      for (const l of listeners) l();
    },
  };
}
