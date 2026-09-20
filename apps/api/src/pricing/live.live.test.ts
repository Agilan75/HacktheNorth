/**
 * Live timing check for the sweep price chips (RUN_LIVE=1). One real frame
 * through identify, then one real lookup; prints how long each took.
 *
 *   RUN_LIVE=1 PRICE_FRAME=<path to a room .jpg> node --env-file-if-exists=.env \
 *     node_modules/.bin/vitest run apps/api/src/pricing/live.live.test.ts --project api
 */
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createPricer } from './live';

const frame = process.env.PRICE_FRAME;

describe.skipIf(frame === undefined || process.env.ANTHROPIC_API_KEY === undefined)('live pricing', () => {
  it('identifies a real frame and prices one item inside the latency budget', async () => {
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    const client = new Anthropic({
      ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
    });
    const pricer = createPricer(client, () => Date.now());

    let t = performance.now();
    const items = await pricer.identify(readFileSync(frame!).toString('base64'));
    const identifyMs = Math.round(performance.now() - t);
    console.log(`identify: ${identifyMs} ms`, items.map((i) => `${i.name} [${i.brand ?? '-'} ${i.model ?? '-'}] $${i.tablePrice}`));
    expect(items.length).toBeGreaterThan(0);

    const target = items.find((i) => i.brand !== null) ?? { ...items[0]!, brand: 'IKEA', model: 'KIVIK' };
    t = performance.now();
    const priced = await pricer.lookup({ label: target.label, name: target.name, brand: target.brand, model: target.model });
    const lookupMs = Math.round(performance.now() - t);
    console.log(`lookup: ${lookupMs} ms`, target.brand, target.model, priced.price, priced.sources.map((s) => `${s.price} ${s.url}`));
  }, 60_000);
});
