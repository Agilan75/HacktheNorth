import { describe, expect, it } from 'vitest';

import type { LiveItem, LiveLookupResult } from './api';
import { createLivePricer } from './livePrice';

function item(label: string, brand: string | null, model: string | null, tablePrice: number): LiveItem {
  const n = (v: string | null) => (v ?? '').toLowerCase();
  return { label, name: label, brand, model, confidence: 0.9, tablePrice, key: `${label}|${n(brand)}|${n(model)}` };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createLivePricer', () => {
  it('shows ballparks at once, refines branded items, and upgrades an unbranded sighting', async () => {
    const lookup = deferred<LiveLookupResult>();
    const frames = [
      [item('sofa', null, null, 1200), item('tv', null, null, 600)],
      [item('tv', 'Samsung', 'Q80C', 600), item('sofa', null, null, 1200)],
    ];
    let call = 0;
    const pricer = createLivePricer({
      identifyItems: async () => ({ items: frames[call++]! }),
      lookupPrice: () => lookup.promise,
    });

    pricer.onFrame('a');
    await Promise.resolve();
    await Promise.resolve();
    expect(pricer.snapshot().total).toBe(1800);

    pricer.onFrame('b');
    await Promise.resolve();
    await Promise.resolve();
    const mid = pricer.snapshot();
    expect(mid.entries.map((e) => [e.item.key, e.status])).toEqual([
      ['sofa||', 'ballpark'],
      ['tv|samsung|q80c', 'searching'],
    ]);

    lookup.resolve({ key: 'tv|samsung|q80c', price: 1049, tablePrice: 600, sources: [], cached: false });
    const report = await pricer.finish(1000);
    expect(report.total).toBe(2249);
    expect(report.sourcedCount).toBe(1);
    expect(report.unfinished).toBe(0);
  });

  it('returns the report at the deadline with ballparks for unfinished lookups', async () => {
    const pricer = createLivePricer({
      identifyItems: async () => ({ items: [item('fridge', 'LG', null, 1800)] }),
      lookupPrice: () => new Promise(() => undefined),
    });
    pricer.onFrame('a');
    const started = Date.now();
    const report = await pricer.finish(50);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(report.unfinished).toBe(1);
    expect(report.total).toBe(1800);
  });
});
