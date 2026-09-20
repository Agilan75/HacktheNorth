/**
 * Runs every plugin, turns failures into "unavailable" cards, and returns the
 * merged `ExternalValue[]`. Body owned by Run 1 unit A08.
 */
import type { EnrichmentCardDto } from '@retrofit/contracts';
import { createFireStationPlugin } from './fire-station';
import { createFloodPlugin } from './flood';
import { ENRICH_TIMEOUT_MS } from './types';
import type { EnrichContext, EnrichOutcome, EnrichPlugin } from './types';

/**
 * Backstop per plugin. Each HTTP call already stops at 6 s; a location that
 * must be geocoded first spends up to 6 s on Nominatim and 6 s on the lookup,
 * so the runner cuts a plugin off only after both budgets (docs/decisions/A08.md).
 */
export const PLUGIN_DEADLINE_MS = 2 * ENRICH_TIMEOUT_MS;

/** The two shipping plugins (PRD §8), in card order. Fresh instances per call. */
export function defaultPlugins(): readonly EnrichPlugin[] {
  return [createFloodPlugin(), createFireStationPlugin()];
}

/**
 * Runs the plugins concurrently and returns one outcome per plugin, in plugin
 * order. Never rejects: a plugin that throws, times out, is aborted, returns a
 * malformed outcome, or is cut for writing nothing becomes an "unavailable"
 * outcome with no values.
 */
export async function runEnrichment(
  context: EnrichContext,
  plugins?: readonly EnrichPlugin[],
): Promise<readonly EnrichOutcome[]> {
  const list = plugins ?? defaultPlugins();
  return Promise.all(list.map((plugin) => runOne(plugin, context)));
}

async function runOne(plugin: EnrichPlugin, context: EnrichContext): Promise<EnrichOutcome> {
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);

  // PRD §8: a plugin that cannot move a score, the premium, or raise a
  // contradiction is cut. One that declares no canonical path is never run.
  if (plugin.writes.length === 0) {
    return unavailable(plugin, 'Plugin writes no canonical field and is cut', 0);
  }
  if (context.signal?.aborted) return unavailable(plugin, 'aborted', 0);

  const controller = new AbortController();
  const onOuterAbort = (): void => controller.abort();
  context.signal?.addEventListener('abort', onOuterAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject before aborting so the race reports a timeout, not "aborted".
      reject(new Error(`timeout after ${PLUGIN_DEADLINE_MS} ms`));
      controller.abort();
    }, PLUGIN_DEADLINE_MS);
  });
  const outerAborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  deadline.catch(() => undefined);
  outerAborted.catch(() => undefined);

  try {
    const work = Promise.resolve().then(() =>
      plugin.run({ ...context, signal: controller.signal }),
    );
    const outcome = await Promise.race([work, deadline, outerAborted]);
    return sanitize(plugin, context, outcome, elapsed());
  } catch (error) {
    return unavailable(plugin, message(error), elapsed());
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    context.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Trust nothing a plugin hands back: the outcome is re-keyed to the plugin's
 * source, an unavailable outcome carries no values, and every value must be
 * `enrichment` provenance on a path the plugin declared.
 */
function sanitize(
  plugin: EnrichPlugin,
  context: EnrichContext,
  outcome: unknown,
  durationMs: number,
): EnrichOutcome {
  if (!isOutcome(outcome)) return unavailable(plugin, 'Plugin returned a malformed result', durationMs);

  if (!outcome.available) {
    const reason = nonEmpty(outcome.unavailableReason) ?? nonEmpty(outcome.card.unavailableReason) ?? 'Source unavailable';
    return unavailable(plugin, reason, outcome.durationMs > 0 ? outcome.durationMs : durationMs, outcome.raw);
  }

  const values = outcome.values
    .filter((v) => declares(plugin.writes, v.canonicalPath))
    .map((v) => ({
      canonicalPath: v.canonicalPath,
      value: v.value,
      provenance: {
        ...v.provenance,
        source: 'enrichment' as const,
        observedAt: v.provenance.observedAt ?? context.nowIso,
      },
    }));

  return {
    source: plugin.source,
    available: true,
    unavailableReason: null,
    values,
    card: {
      ...outcome.card,
      source: plugin.source,
      title: outcome.card.title || plugin.title,
      available: true,
      unavailableReason: null,
      fetchedAt: outcome.card.fetchedAt ?? context.nowIso,
      attribution: outcome.card.attribution || plugin.attribution,
    },
    raw: outcome.raw,
    durationMs: outcome.durationMs > 0 ? outcome.durationMs : durationMs,
  };
}

/** The "unavailable" card (PRD §8): no values, no fields, a reason. */
function unavailable(
  plugin: EnrichPlugin,
  reason: string,
  durationMs: number,
  raw?: Readonly<Record<string, unknown>>,
): EnrichOutcome {
  const card: EnrichmentCardDto = {
    source: plugin.source,
    title: plugin.title,
    available: false,
    unavailableReason: reason,
    fetchedAt: null,
    fields: [],
    attribution: plugin.attribution,
  };
  return {
    source: plugin.source,
    available: false,
    unavailableReason: reason,
    values: [],
    card,
    raw: raw ?? { error: reason },
    durationMs,
  };
}

/** `locations.L1.floodZone` matches the declared `locations[].floodZone`. */
function declares(writes: readonly string[], canonicalPath: string): boolean {
  return writes.some((declared) => {
    const pattern = declared
      .split('[]')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\.[^.]+');
    return new RegExp(`^${pattern}$`).test(canonicalPath);
  });
}

function isOutcome(v: unknown): v is EnrichOutcome {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Partial<EnrichOutcome>;
  return (
    typeof o.available === 'boolean' &&
    Array.isArray(o.values) &&
    typeof o.card === 'object' &&
    o.card !== null &&
    Array.isArray(o.card.fields) &&
    typeof o.raw === 'object' &&
    o.raw !== null &&
    typeof o.durationMs === 'number'
  );
}

function nonEmpty(s: string | null | undefined): string | null {
  return typeof s === 'string' && s.trim().length > 0 ? s : null;
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim().length > 0 ? text : 'Plugin failed';
}
