import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { ApiEnv } from '../app';
import { createPriceRoutes } from '../routes/price';
import { createPricer, dollarsIn, itemKey, priceFromSources } from './live';
import type { PricingClient } from './live';

/** A fake `messages.create` that returns canned content blocks and records each request. */
function fakeClient(reply: (params: Record<string, unknown>) => unknown[]): { client: PricingClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        calls.push(params);
        return { stop_reason: 'end_turn', content: reply(params) };
      },
    },
  } as unknown as PricingClient;
  return { client, calls };
}

const text = (t: string) => ({ type: 'text', text: t, citations: null });
const cited = (t: string, quotes: { url: string; quote: string }[]) => ({
  type: 'text',
  text: t,
  citations: quotes.map((q) => ({ type: 'web_search_result_location', url: q.url, title: null, cited_text: q.quote, encrypted_index: 'x' })),
});

describe('dollarsIn', () => {
  it('reads plain, comma and cents figures', () => {
    expect(dollarsIn('Now $1,299.99, was $1499; case $29')).toEqual([1299.99, 1499, 29]);
  });
});

describe('priceFromSources', () => {
  it('drops accessories and outliers and takes the median', () => {
    const s = (url: string, price: number) => ({ url, title: null, quote: '', price });
    const out = priceFromSources([s('a', 999), s('b', 1099), s('c', 1199), s('d', 19), s('e', 99999)], 600);
    expect(out.price).toBe(1099);
    expect(out.kept).toHaveLength(3);
  });

  it('is null when nothing plausible was quoted', () => {
    expect(priceFromSources([], 600).price).toBeNull();
  });
});

describe('identify', () => {
  it('maps unknown labels to other, dedupes, and attaches the table price', async () => {
    const { client, calls } = fakeClient(() => [
      text(
        JSON.stringify({
          items: [
            { label: 'tv', name: 'wall TV', brand: 'Samsung', model: 'QN65Q80C', confidence: 0.9 },
            { label: 'tv', name: 'same TV', brand: 'samsung', model: 'QN65Q80C', confidence: 0.8 },
            { label: 'spaceship', name: 'odd thing', brand: null, model: null, confidence: 0.4 },
          ],
        }),
      ),
    ]);
    const items = await createPricer(client, () => 0).identify('x'.repeat(200));
    expect(items.map((i) => [i.label, i.tablePrice])).toEqual([
      ['tv', 600],
      ['other', 100],
    ]);
    expect(items[0]!.key).toBe(itemKey('tv', 'Samsung', 'QN65Q80C'));
    expect(calls[0]!.model).toBe('claude-haiku-4-5');
  });
});

describe('lookup', () => {
  it('prices from cited source text only and caches per item', async () => {
    const { client, calls } = fakeClient(() => [
      text('Searching.'),
      cited('It sells for about a thousand dollars.', [
        { url: 'https://shop-a.example/tv', quote: 'Samsung 65" Q80C - $1,097.99' },
        { url: 'https://shop-b.example/tv', quote: 'Sale price $999.99. Wall mount $39.99' },
      ]),
    ]);
    const pricer = createPricer(client, () => 0);
    const req = { label: 'tv' as const, name: 'wall TV', brand: 'Samsung', model: 'QN65Q80C' };
    const first = await pricer.lookup(req);
    expect(first.price).toBe(1049);
    expect(first.sources.map((s) => s.price)).toEqual([1097.99, 999.99]);
    const second = await pricer.lookup(req);
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('routes', () => {
  it('validates and serves identify', async () => {
    const { client } = fakeClient(() => [text(JSON.stringify({ items: [] }))]);
    const app = new Hono<ApiEnv>();
    createPriceRoutes(createPricer(client, () => 0))(app, {} as never);
    const bad = await app.request('/price/identify', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(422);
    const ok = await app.request('/price/identify', {
      method: 'POST',
      body: JSON.stringify({ imageBase64: 'x'.repeat(200) }),
      headers: { 'content-type': 'application/json' },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ items: [] });
  });
});
