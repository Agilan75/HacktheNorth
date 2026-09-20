/**
 * Live sweep pricing: what the phone calls on every frame while the user is
 * still panning, so a price shows up in about a second instead of after Finish.
 *
 *  - `identifyFrame`: one frame -> the furniture and appliances in it, with the
 *    brand and model when visible. Goes through the routed `LlmProvider`, so it
 *    runs on whichever vision model the API is configured with (Gemini).
 *  - `lookupPrice`: one branded item -> a sourced US retail price. Needs the
 *    Anthropic web-search tool; when no Anthropic client is configured, the
 *    lookup answers at once with the table price and no sources, and the phone
 *    keeps showing the ballpark. When it runs, the dollar figures are read by
 *    code from the quoted source text (citations), filtered against the table
 *    price, and the median is taken. The model never states the number used.
 *
 * The ballpark from `table.ts` is always returned first, so the lookup only
 * ever refines a number the user already sees.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { LlmProvider, ResponseSchemaNode } from '../llm/types';
import { PRICE_LABELS, PRICE_TABLE, isPriceLabel, tablePrice } from './table';
import type { PriceLabel } from './table';

export const LOOKUP_MODEL = 'claude-haiku-4-5';
const LOOKUP_TIMEOUT_MS = 15_000;
const MAX_ITEMS_PER_FRAME = 6;
/** Below this the model is guessing; a guessed sofa is worse than no sofa on a quote. */
const MIN_IDENTIFY_CONFIDENCE = 0.5;
/** Labels the model may return. `other` is deliberately absent: unnamed things are dropped, not priced. */
const IDENTIFY_LABELS = PRICE_LABELS.filter((l) => l !== 'other');
/** A sourced figure outside [LOW, HIGH] x the table price is an accessory, a part or a typo. */
const PLAUSIBLE_LOW = 0.15;
const PLAUSIBLE_HIGH = 8;
const LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type PricingClient = Pick<Anthropic, 'messages'>;

export interface IdentifiedItem {
  readonly label: PriceLabel;
  /** Short plain description, e.g. "grey three-seat fabric sofa". */
  readonly name: string;
  readonly brand: string | null;
  readonly model: string | null;
  readonly confidence: number;
  /** Ballpark from the table, whole USD. */
  readonly tablePrice: number;
  /** Stable key the phone uses to merge the same item across frames. */
  readonly key: string;
}

export interface PriceSource {
  readonly url: string;
  readonly title: string | null;
  readonly quote: string;
  readonly price: number;
}

export interface LookupResult {
  readonly key: string;
  /** Median of the plausible sourced figures; null when none were found. */
  readonly price: number | null;
  readonly tablePrice: number;
  readonly sources: readonly PriceSource[];
  readonly cached: boolean;
}

export interface LookupRequest {
  readonly label: PriceLabel;
  readonly name: string;
  readonly brand: string | null;
  readonly model: string | null;
}

/* -------------------------------------------------------------------------- */
/* Identify                                                                   */
/* -------------------------------------------------------------------------- */

/** Lenient on purpose: one odd row must not cost the whole frame. Code filters below. */
const identifyOutput = z.object({
  items: z
    .array(
      z.object({
        label: z.string(),
        name: z.string().optional().default(''),
        brand: z.string().nullable().optional().default(null),
        model: z.string().nullable().optional().default(null),
        confidence: z.number(),
      }),
    )
    .max(20),
});
type IdentifyRaw = z.infer<typeof identifyOutput>;

const IDENTIFY_RESPONSE: ResponseSchemaNode = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING', enum: IDENTIFY_LABELS },
          name: { type: 'STRING', description: 'Short plain description, under 8 words.' },
          brand: { type: 'STRING', nullable: true },
          model: { type: 'STRING', nullable: true },
          confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
        },
        required: ['label', 'name', 'brand', 'model', 'confidence'],
        propertyOrdering: ['label', 'name', 'brand', 'model', 'confidence'],
      },
    },
  },
  required: ['items'],
  propertyOrdering: ['items'],
};

const IDENTIFY_SYSTEM =
  'You list the furniture, appliances and electronics clearly visible in one photo of a room. ' +
  'Skip walls, fixtures, small clutter and anything cut off so badly it cannot be named. ' +
  'If something does not fit one of the allowed labels, leave it out entirely; never force a label. ' +
  `At most ${MAX_ITEMS_PER_FRAME} items, largest or most valuable first. ` +
  'Give a brand or model only when it is readable or unmistakable from the design (a logo, a badge, an iconic shape); otherwise null. ' +
  'Never guess a price.';

function norm(value: string | null): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Same label + brand + model = same item, so the phone counts it once. */
export function itemKey(label: PriceLabel, brand: string | null, model: string | null): string {
  return [label, norm(brand), norm(model)].join('|');
}

export async function identifyFrame(llm: LlmProvider, imageBase64: string): Promise<readonly IdentifiedItem[]> {
  const result = await llm.generateJson<IdentifyRaw>({
    callName: 'identify',
    prompt: 'List the items.',
    parts: [{ kind: 'image', mimeType: 'image/jpeg', dataBase64: imageBase64 }],
    schema: { zod: identifyOutput as unknown as z.ZodType<IdentifyRaw>, response: IDENTIFY_RESPONSE },
    systemInstruction: IDENTIFY_SYSTEM,
    temperature: 0,
  });
  if (result.degraded) return [];

  const out: IdentifiedItem[] = [];
  const seen = new Set<string>();
  for (const raw of result.data.items) {
    // Anything the model could not name with a real label, or was not sure of,
    // is dropped: it would otherwise show as a "$100 other item" on the quote.
    if (!isPriceLabel(raw.label) || raw.label === 'other') continue;
    const confidence = Math.min(1, Math.max(0, raw.confidence));
    if (confidence < MIN_IDENTIFY_CONFIDENCE) continue;
    const label: PriceLabel = raw.label;
    const brand = raw.brand?.trim() || null;
    const model = raw.model?.trim() || null;
    const key = itemKey(label, brand, model);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label,
      name: raw.name.trim().slice(0, 80) || PRICE_TABLE[label].name,
      brand,
      model,
      confidence,
      tablePrice: tablePrice(label),
      key,
    });
    if (out.length === MAX_ITEMS_PER_FRAME) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Lookup                                                                     */
/* -------------------------------------------------------------------------- */

const DOLLARS = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g;

/** Every dollar figure written in a piece of source text. */
export function dollarsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(DOLLARS)) {
    const whole = Number((m[1] ?? '').replace(/,/g, ''));
    const cents = m[2] === undefined ? 0 : Number(m[2]) / 100;
    if (Number.isFinite(whole)) out.push(whole + cents);
  }
  return out;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Plausible sourced figures only, one per (url, figure); the median, rounded to whole dollars. */
export function priceFromSources(sources: readonly PriceSource[], table: number): {
  readonly price: number | null;
  readonly kept: readonly PriceSource[];
} {
  const lo = table * PLAUSIBLE_LOW;
  const hi = table * PLAUSIBLE_HIGH;
  const seen = new Set<string>();
  const kept = sources.filter((s) => {
    const id = `${s.url}|${s.price}`;
    if (seen.has(id) || s.price < lo || s.price > hi) return false;
    seen.add(id);
    return true;
  });
  return { price: kept.length === 0 ? null : Math.round(median(kept.map((s) => s.price))), kept };
}

function lookupQuery(req: LookupRequest): string {
  return [req.brand, req.model, req.model === null ? req.name : PRICE_TABLE[req.label].name]
    .filter((p): p is string => p !== null && p.length > 0)
    .join(' ');
}

interface CacheEntry {
  readonly at: number;
  readonly result: Promise<LookupResult>;
}

export interface Pricer {
  identify(imageBase64: string): Promise<readonly IdentifiedItem[]>;
  lookup(req: LookupRequest): Promise<LookupResult>;
}

export interface PricerDeps {
  /** Identifies items in a frame. The routed provider: Gemini unless another vision model is configured. */
  readonly llm: LlmProvider;
  /** Sourced price lookups need Anthropic's web search. Absent, lookups return the table price. */
  readonly anthropic?: PricingClient;
}

/**
 * The service the route uses. Lookups are cached per item key and shared while
 * in flight, so the same TV seen in five frames costs one search.
 */
export function createPricer(deps: PricerDeps, nowMs: () => number): Pricer {
  const cache = new Map<string, CacheEntry>();
  const { llm, anthropic } = deps;

  async function search(req: LookupRequest, key: string): Promise<LookupResult> {
    const table = tablePrice(req.label);
    if (anthropic === undefined) return { key, price: null, tablePrice: table, sources: [], cached: false };
    const response = await anthropic.messages.create(
      {
        model: LOOKUP_MODEL,
        max_tokens: 1024,
        temperature: 0,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 1,
            user_location: { type: 'approximate', country: 'US' },
          },
        ],
        messages: [
          {
            role: 'user',
            content:
              `${lookupQuery(req)} price. Search for US listings that show a dollar price for it new ` +
              '(retailers, price trackers, reviews). Reply only with the prices you found, each quoted from its source with the dollar sign.',
          },
        ],
      },
      { timeout: LOOKUP_TIMEOUT_MS, maxRetries: 1 },
    );

    const sources: PriceSource[] = [];
    for (const block of response.content) {
      if (block.type !== 'text') continue;
      for (const c of block.citations ?? []) {
        if (c.type !== 'web_search_result_location') continue;
        for (const price of dollarsIn(c.cited_text)) {
          sources.push({ url: c.url, title: c.title, quote: c.cited_text.slice(0, 200), price });
        }
      }
    }
    const { price, kept } = priceFromSources(sources, table);
    return { key, price, tablePrice: table, sources: kept, cached: false };
  }

  return {
    identify: (imageBase64) => identifyFrame(llm, imageBase64),
    lookup(req) {
      const key = itemKey(req.label, req.brand, req.model);
      const hit = cache.get(key);
      if (hit !== undefined && nowMs() - hit.at < LOOKUP_CACHE_TTL_MS) {
        return hit.result.then((r) => ({ ...r, cached: true }));
      }
      const result = search(req, key);
      cache.set(key, { at: nowMs(), result });
      // A failed search is never cached.
      result.catch(() => cache.delete(key));
      return result;
    },
  };
}
