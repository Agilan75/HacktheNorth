import { describe, expect, it, vi } from 'vitest';

import { createRoomsStore } from './rooms';
import type { RoomEntry } from './rooms';

function entry(sweepId: string, over: Partial<RoomEntry> = {}): RoomEntry {
  return { sweepId, roomLabel: 'Kitchen', termMonths: 12, source: 'sweep', ...over };
}

describe('rooms store', () => {
  it('starts empty', () => {
    expect(createRoomsStore().getRooms()).toEqual([]);
  });

  it('lists the newest room first', () => {
    const store = createRoomsStore();
    store.record(entry('a'));
    store.record(entry('b', { roomLabel: 'Bedroom' }));
    expect(store.getRooms().map((r) => r.sweepId)).toEqual(['b', 'a']);
  });

  it('ignores a sweep id it already holds, and does not notify for it', () => {
    const store = createRoomsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.record(entry('a'));
    store.record(entry('a', { roomLabel: 'Renamed' }));

    expect(store.getRooms()).toHaveLength(1);
    expect(store.getRooms()[0]?.roomLabel).toBe('Kitchen');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores a blank sweep id', () => {
    const store = createRoomsStore();
    store.record(entry(''));
    store.record(entry('   '));
    expect(store.getRooms()).toEqual([]);
  });

  it('trims the id and the label', () => {
    const store = createRoomsStore();
    store.record(entry('  s1  ', { roomLabel: '  Kitchen  ' }));
    expect(store.getRooms()[0]).toMatchObject({ sweepId: 's1', roomLabel: 'Kitchen' });
  });

  it('keeps a blank label rather than inventing one', () => {
    const store = createRoomsStore();
    store.record(entry('s1', { roomLabel: '' }));
    expect(store.getRooms()[0]?.roomLabel).toBe('');
  });

  it('keeps the term and source each room was sent under', () => {
    const store = createRoomsStore();
    store.record(entry('s1', { termMonths: 4, source: 'upload' }));
    store.record(entry('s2', { termMonths: 8, source: null }));
    expect(store.getRooms()).toEqual([
      { sweepId: 's2', roomLabel: 'Kitchen', termMonths: 8, source: null },
      { sweepId: 's1', roomLabel: 'Kitchen', termMonths: 4, source: 'upload' },
    ]);
  });

  /** The queued-sweep bug: a late room must not take the live room's identity. */
  it('records a late sweep under its own label, not a later room’s', () => {
    const store = createRoomsStore();
    // Room 1 was sent while offline; its metadata was captured at submit time.
    const queued = entry('late', { roomLabel: 'Kitchen', termMonths: 4 });
    // Room 2 is scanned and lands first.
    store.record(entry('second', { roomLabel: 'Bedroom', termMonths: 12 }));
    // Room 1 finally uploads.
    store.record(queued);

    expect(store.getRooms()).toEqual([
      { sweepId: 'late', roomLabel: 'Kitchen', termMonths: 4, source: 'sweep' },
      { sweepId: 'second', roomLabel: 'Bedroom', termMonths: 12, source: 'sweep' },
    ]);
  });

  it('returns a stable snapshot between records, so a subscriber cannot loop', () => {
    const store = createRoomsStore();
    store.record(entry('a'));
    expect(store.getRooms()).toBe(store.getRooms());
  });

  it('stops notifying once unsubscribed', () => {
    const store = createRoomsStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.record(entry('a'));
    off();
    store.record(entry('b'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears', () => {
    const store = createRoomsStore();
    store.record(entry('a'));
    store.clear();
    expect(store.getRooms()).toEqual([]);
  });
});
