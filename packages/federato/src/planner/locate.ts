/**
 * Step 3 of PRD §7.5: locate each needed field in the schema — synonym table
 * first, then a graph search, then the injected Gemini assist at >= 0.8.
 * Names that resolve below the gate stay visibly unmapped.
 * Body owned by Run 1 unit F08.
 */
import { MIN_MAP_CONFIDENCE } from '@retrofit/engine';
import type {
  FieldMap,
  FieldMapEntry,
  SchemaDocument,
  SchemaField,
  SchemaResource,
  UnmappedKey,
} from '@retrofit/engine';
import type {
  FederatoResource,
  GraphPath,
  LocatedField,
  LocateMethod,
  LocateResult,
  NeededField,
  ResourceGraph,
  SchemaAssistFn,
  SchemaAssistMapping,
  SchemaAssistRequest,
} from '../types';
import { pathsFrom } from './graph';
import { lookupSynonym } from './synonyms';

export interface LocateInput {
  readonly needed: readonly NeededField[];
  readonly schema: SchemaDocument;
  readonly graph: ResourceGraph;
  /** Injected. Absent means the planner stays fully deterministic. */
  readonly schemaAssist?: SchemaAssistFn | undefined;
}

/* -------------------------------------------------------------------------- */
/* Private constants                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Root preference. The deep pass is rooted at `Policy` and the no-policy
 * follow-up at `Submission` (PRD §7.5 step 4), so every field is addressed
 * from one of those two when it can be.
 */
const ROOTS: readonly FederatoResource[] = ['Policy', 'Submission'];

const RESOURCES: readonly FederatoResource[] = [
  'Submission',
  'Policy',
  'Insured',
  'Location',
  'Building',
  'ExposureUnit',
  'Coverage',
  'Claim',
  'Endorsement',
  'Broker',
  'Contact',
  'Underwriter',
];

/** A unique normalized-name match inside the resource the canonical path names. */
const GRAPH_CONFIDENCE = 0.85;
/** A guess outside that resource, or an ambiguous one: shown, never accepted. */
const GRAPH_GUESS_CONFIDENCE = 0.6;
/** Deepest reference chain the graph step will consider from a root. */
const MAX_HOPS = 4;

/* -------------------------------------------------------------------------- */
/* Private helpers — schema walking                                           */
/* -------------------------------------------------------------------------- */

interface SchemaWalk {
  readonly leafResource: FederatoResource;
  readonly leafField: SchemaField;
  /** Reference fields crossed inside the walked path. */
  readonly hops: readonly string[];
  readonly crossesArray: boolean;
}

interface Route {
  readonly root: FederatoResource;
  readonly hops: readonly string[];
  readonly dotPath: string;
  readonly crossesArray: boolean;
}

interface Resolved {
  readonly canonicalPath: string;
  readonly method: Exclude<LocateMethod, 'unmapped'>;
  readonly confidence: number;
  readonly route: Route;
  readonly walk: SchemaWalk;
  /** Path relative to the leaf's owning resource, as walked. */
  readonly relPath: string;
  readonly ownerResource: FederatoResource;
  readonly why: string;
}

interface Guess {
  readonly rawPath: string;
  readonly confidence: number;
  readonly why: string;
}

function isResource(name: string): name is FederatoResource {
  return (RESOURCES as readonly string[]).includes(name);
}

function resourceOf(schema: SchemaDocument, name: string): SchemaResource | null {
  return schema.resources.find((r) => r.name === name) ?? null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isArrayField(f: SchemaField): boolean {
  return f.isArray === true || f.type === 'array';
}

/**
 * Walks a dot-path from `resource` through the flattened schema. Field paths
 * may themselves contain dots (`producer.broker`), so the longest matching
 * field prefix wins at each step, and references are followed.
 */
function walkSchema(
  schema: SchemaDocument,
  resource: FederatoResource,
  path: string,
): SchemaWalk | null {
  const segments = path.split('.').filter((s) => s !== '');
  if (segments.length === 0) return null;
  let current: FederatoResource = resource;
  let i = 0;
  const hops: string[] = [];
  let crossesArray = false;
  for (let guard = 0; guard < 32; guard += 1) {
    const res = resourceOf(schema, current);
    if (res === null) return null;
    let match: SchemaField | null = null;
    let used = 0;
    for (let k = segments.length; k > i; k -= 1) {
      const candidate = segments.slice(i, k).join('.');
      const f = res.fields.find((x) => x.path === candidate);
      if (f !== undefined) {
        match = f;
        used = k - i;
        break;
      }
    }
    if (match === null) return null;
    i += used;
    if (i === segments.length) {
      return { leafResource: current, leafField: match, hops, crossesArray };
    }
    if (match.reference === undefined || !isResource(match.reference)) return null;
    hops.push(match.path);
    if (isArrayField(match)) crossesArray = true;
    current = match.reference;
  }
  return null;
}

/** `Building.year_built` -> { resource: 'Building', path: 'year_built' }. */
function parseRawPath(raw: string): { resource: FederatoResource; path: string } | null {
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const resource = raw.slice(0, dot);
  const path = raw.slice(dot + 1);
  if (!isResource(resource) || path === '') return null;
  return { resource, path };
}

/** Every non-reference field, as `Resource.path`. */
function leafRawPaths(schema: SchemaDocument): readonly string[] {
  const out: string[] = [];
  for (const r of schema.resources) {
    if (!isResource(r.name)) continue;
    for (const f of r.fields) {
      if (f.reference !== undefined || f.type === 'reference') continue;
      out.push(`${r.name}.${f.path}`);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/* -------------------------------------------------------------------------- */
/* Private helpers — routing from a root                                      */
/* -------------------------------------------------------------------------- */

/** Canonical `[]` segments mean "one per item": prefer a route that fans out. */
function wantsArray(canonicalPath: string): boolean {
  return canonicalPath.includes('[]');
}

function graphPaths(graph: ResourceGraph, root: FederatoResource): readonly GraphPath[] {
  return pathsFrom(graph, root, MAX_HOPS);
}

/**
 * Route from a preferred root to `target`. The target is its own route when it
 * is a root. Otherwise, per root in preference order: among graph paths that
 * end at `target`, prefer one that crosses an array when the canonical path is
 * per-item, then fewer hops, then the dot-path alphabetically.
 */
function routeTo(
  graph: ResourceGraph,
  target: FederatoResource,
  perItem: boolean,
): { route: Route; rejected: readonly string[] } {
  if (ROOTS.includes(target)) {
    return { route: { root: target, hops: [], dotPath: '', crossesArray: false }, rejected: [] };
  }
  for (const root of ROOTS) {
    const candidates = graphPaths(graph, root).filter((p) => p.to === target && p.hops > 0);
    if (candidates.length === 0) continue;
    const ranked = [...candidates].sort(
      (a, b) =>
        (perItem ? Number(b.crossesArray) - Number(a.crossesArray) : 0) ||
        a.hops - b.hops ||
        a.dotPath.localeCompare(b.dotPath),
    );
    const best = ranked[0] as GraphPath;
    return {
      route: {
        root,
        hops: best.edges.map((e) => e.field),
        dotPath: best.dotPath,
        crossesArray: best.crossesArray,
      },
      rejected: ranked.slice(1).map((p) => `${root}.${p.dotPath}`),
    };
  }
  return { route: { root: target, hops: [], dotPath: '', crossesArray: false }, rejected: [] };
}

function resolve(
  input: LocateInput,
  canonicalPath: string,
  owner: FederatoResource,
  relPath: string,
  method: Exclude<LocateMethod, 'unmapped'>,
  confidence: number,
  why: string,
): Resolved | null {
  const walk = walkSchema(input.schema, owner, relPath);
  if (walk === null) return null;
  const { route, rejected } = routeTo(input.graph, owner, wantsArray(canonicalPath));
  const routeWhy =
    route.hops.length === 0
      ? ` Read directly on ${route.root}.`
      : ` Reached from ${route.root} via ${route.dotPath}` +
        (rejected.length > 0 ? `; rejected ${rejected.slice(0, 3).join(', ')}.` : '.');
  return {
    canonicalPath,
    method,
    confidence,
    route,
    walk,
    relPath,
    ownerResource: owner,
    why: why + routeWhy,
  };
}

function toLocated(r: Resolved): LocatedField {
  const schemaPath = r.route.dotPath === '' ? r.relPath : `${r.route.dotPath}.${r.relPath}`;
  return {
    canonicalPath: r.canonicalPath,
    rootResource: r.route.root,
    schemaPath,
    referenceHops: [...r.route.hops, ...r.walk.hops],
    confidence: r.confidence,
    method: r.method,
    crossesArray: r.route.crossesArray || r.walk.crossesArray,
    why: r.why,
  };
}

/* -------------------------------------------------------------------------- */
/* Step 3a — synonym table                                                    */
/* -------------------------------------------------------------------------- */

function viaSynonym(
  input: LocateInput,
  field: NeededField,
): { resolved: Resolved | null; guess: Guess | null; note: string | null } {
  const entry = lookupSynonym(field.canonicalPath);
  if (entry === null) return { resolved: null, guess: null, note: null };
  const raw = `${entry.resource}.${entry.schemaPath}`;
  if (walkSchema(input.schema, entry.resource, entry.schemaPath) === null) {
    return {
      resolved: null,
      guess: null,
      note: `Synonym ${raw} is not in the live schema.`,
    };
  }
  if (!(entry.confidence >= MIN_MAP_CONFIDENCE)) {
    return {
      resolved: null,
      guess: {
        rawPath: raw,
        confidence: entry.confidence,
        why: `Synonym table maps it to ${raw} at ${entry.confidence}, below the ${MIN_MAP_CONFIDENCE} gate.`,
      },
      note: null,
    };
  }
  const resolved = resolve(
    input,
    field.canonicalPath,
    entry.resource,
    entry.schemaPath,
    'synonym',
    entry.confidence,
    `Synonym table: ${field.canonicalPath} -> ${raw}${entry.note === undefined ? '' : ` (${entry.note})`}.`,
  );
  return { resolved, guess: null, note: null };
}

/* -------------------------------------------------------------------------- */
/* Step 3b — graph search on normalized names                                 */
/* -------------------------------------------------------------------------- */

/** The resource a canonical path names, e.g. `buildings[]` -> `Building`. */
function hintedResource(schema: SchemaDocument, canonicalPath: string): FederatoResource | null {
  const segments = canonicalPath.split('.').slice(0, -1);
  for (const seg of segments) {
    const base = norm(seg.replace(/\[\]$/, ''));
    const singular = base.endsWith('s') ? base.slice(0, -1) : base;
    for (const r of schema.resources) {
      if (!isResource(r.name)) continue;
      const n = norm(r.name);
      if (n === base || n === singular) return r.name;
    }
  }
  return null;
}

function leafMatches(res: SchemaResource, leaf: string): readonly SchemaField[] {
  return res.fields.filter((f) => {
    if (f.reference !== undefined || f.type === 'reference') return false;
    const last = f.path.split('.').pop() ?? f.path;
    return norm(f.path) === leaf || norm(last) === leaf;
  });
}

function viaGraph(
  input: LocateInput,
  field: NeededField,
): { resolved: Resolved | null; guess: Guess | null } {
  const leafSeg = field.canonicalPath.split('.').pop() ?? field.canonicalPath;
  const leaf = norm(leafSeg.replace(/\[\]$/, ''));
  if (leaf === '' || field.canonicalPath.startsWith('rollup.')) return { resolved: null, guess: null };

  const hinted = hintedResource(input.schema, field.canonicalPath);
  const scope: readonly FederatoResource[] = hinted === null ? ROOTS : [hinted];

  const inScope: { resource: FederatoResource; field: SchemaField }[] = [];
  for (const name of scope) {
    const res = resourceOf(input.schema, name);
    if (res === null) continue;
    for (const f of leafMatches(res, leaf)) inScope.push({ resource: name, field: f });
    if (inScope.length > 0) break; // first root with a match wins
  }

  if (inScope.length === 1) {
    const hit = inScope[0] as { resource: FederatoResource; field: SchemaField };
    const resolved = resolve(
      input,
      field.canonicalPath,
      hit.resource,
      hit.field.path,
      'graph',
      GRAPH_CONFIDENCE,
      `Graph search: ${hit.resource}.${hit.field.path} is the only field on ${hit.resource} named like "${leafSeg}".`,
    );
    return { resolved, guess: null };
  }

  if (inScope.length > 1) {
    const names = inScope.map((h) => `${h.resource}.${h.field.path}`).sort((a, b) => a.localeCompare(b));
    return {
      resolved: null,
      guess: {
        rawPath: names[0] as string,
        confidence: GRAPH_GUESS_CONFIDENCE,
        why: `Graph search is ambiguous: ${names.join(', ')}.`,
      },
    };
  }

  // Nothing in scope: look anywhere.
  const elsewhere: string[] = [];
  const hits: { resource: FederatoResource; field: SchemaField }[] = [];
  for (const r of input.schema.resources) {
    if (!isResource(r.name) || scope.includes(r.name)) continue;
    for (const f of leafMatches(r, leaf)) {
      elsewhere.push(`${r.name}.${f.path}`);
      hits.push({ resource: r.name, field: f });
    }
  }
  elsewhere.sort((a, b) => a.localeCompare(b));
  if (elsewhere.length === 0) return { resolved: null, guess: null };
  // The canonical path names no resource (e.g. `history[]`) and exactly one
  // field in the whole schema carries the name: that is a graph match.
  if (hinted === null && hits.length === 1) {
    const hit = hits[0] as { resource: FederatoResource; field: SchemaField };
    const resolved = resolve(
      input,
      field.canonicalPath,
      hit.resource,
      hit.field.path,
      'graph',
      GRAPH_CONFIDENCE,
      `Graph search: ${hit.resource}.${hit.field.path} is the only field in the schema named like "${leafSeg}".`,
    );
    if (resolved !== null) return { resolved, guess: null };
  }
  // Otherwise it is a visible guess only.
  return {
    resolved: null,
    guess: {
      rawPath: elsewhere[0] as string,
      confidence: GRAPH_GUESS_CONFIDENCE,
      why: `Graph search found ${elsewhere.join(', ')} outside ${scope.join('/')}; not accepted.`,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Step 3c — injected schema assist                                           */
/* -------------------------------------------------------------------------- */

function describe(field: NeededField): string {
  const rules = [...new Set(field.requiredBy.map((r) => r.ruleId))];
  const first = field.requiredBy[0]?.why ?? '';
  return `Needed by ${rules.slice(0, 5).join(', ')}${rules.length > 5 ? ` and ${rules.length - 5} more` : ''}. ${first}`.trim();
}

function unmappedField(canonicalPath: string, why: string): LocatedField {
  return {
    canonicalPath,
    rootResource: null,
    schemaPath: null,
    referenceHops: [],
    confidence: 0,
    method: 'unmapped',
    crossesArray: false,
    why,
  };
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export async function locateFields(input: LocateInput): Promise<LocateResult> {
  const resolved = new Map<string, Resolved>();
  const guesses = new Map<string, Guess>();
  const notes = new Map<string, string[]>();
  const pending: NeededField[] = [];

  const note = (path: string, text: string): void => {
    const list = notes.get(path);
    if (list === undefined) notes.set(path, [text]);
    else list.push(text);
  };
  const keepBestGuess = (path: string, g: Guess | null): void => {
    if (g === null) return;
    const prev = guesses.get(path);
    if (prev === undefined || g.confidence > prev.confidence) guesses.set(path, g);
  };

  // Deduplicate on canonical path, keeping first-seen order.
  const fields: NeededField[] = [];
  const seenPaths = new Set<string>();
  for (const f of input.needed) {
    if (seenPaths.has(f.canonicalPath)) continue;
    seenPaths.add(f.canonicalPath);
    fields.push(f);
  }

  for (const field of fields) {
    const syn = viaSynonym(input, field);
    if (syn.note !== null) note(field.canonicalPath, syn.note);
    keepBestGuess(field.canonicalPath, syn.guess);
    if (syn.resolved !== null) {
      resolved.set(field.canonicalPath, syn.resolved);
      continue;
    }
    const g = viaGraph(input, field);
    keepBestGuess(field.canonicalPath, g.guess);
    if (g.resolved !== null) {
      resolved.set(field.canonicalPath, g.resolved);
      continue;
    }
    pending.push(field);
  }

  // Step 3c: only the names the table and the graph could not resolve.
  let assistUsed = false;
  if (pending.length > 0 && input.schemaAssist !== undefined) {
    const claimed = new Set(
      [...resolved.values()].map((r) => `${r.ownerResource}.${r.relPath}`),
    );
    const offered = leafRawPaths(input.schema).filter((p) => !claimed.has(p));
    const offeredSet = new Set(offered);
    const request: SchemaAssistRequest = {
      unmappedKeys: offered.map((rawPath) => ({ rawPath, sampleValues: [] })),
      canonicalFields: pending.map((f) => ({
        canonicalPath: f.canonicalPath,
        description: describe(f),
      })),
    };
    let mappings: readonly SchemaAssistMapping[] = [];
    try {
      mappings = await input.schemaAssist(request);
      assistUsed = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const f of pending) note(f.canonicalPath, `Schema assist failed: ${msg}.`);
    }

    const pendingSet = new Set(pending.map((f) => f.canonicalPath));
    // Highest confidence first; ties keep the model's order.
    const ordered = mappings
      .map((m, i) => ({ m, i }))
      .sort((a, b) => b.m.confidence - a.m.confidence || a.i - b.i)
      .map((x) => x.m);
    for (const m of ordered) {
      if (!pendingSet.has(m.canonicalPath) || resolved.has(m.canonicalPath)) continue;
      const conf = m.confidence;
      if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) continue;
      const parsed = offeredSet.has(m.rawPath) ? parseRawPath(m.rawPath) : null;
      if (parsed === null) {
        note(m.canonicalPath, `Schema assist proposed ${m.rawPath}, which is not an offered schema field.`);
        continue;
      }
      if (conf < MIN_MAP_CONFIDENCE) {
        keepBestGuess(m.canonicalPath, {
          rawPath: m.rawPath,
          confidence: conf,
          why: `Schema assist proposed ${m.rawPath} at ${conf}, below the ${MIN_MAP_CONFIDENCE} gate: ${m.reason}`,
        });
        continue;
      }
      const r = resolve(
        input,
        m.canonicalPath,
        parsed.resource,
        parsed.path,
        'llm',
        conf,
        `Schema assist: ${m.rawPath} at ${conf} (${m.reason}).`,
      );
      if (r !== null) resolved.set(m.canonicalPath, r);
    }
  }

  const located: LocatedField[] = [];
  const unmapped: LocatedField[] = [];
  const entries: FieldMapEntry[] = [];
  const unmappedKeys: UnmappedKey[] = [];

  for (const field of fields) {
    const r = resolved.get(field.canonicalPath);
    if (r !== undefined) {
      const loc = toLocated(r);
      located.push(loc);
      entries.push({
        rawPath: `${r.walk.leafResource}.${r.walk.leafField.path}`,
        canonicalPath: field.canonicalPath,
        confidence: r.confidence,
        method: r.method,
        note: `${loc.rootResource ?? r.route.root}.${loc.schemaPath ?? r.relPath}`,
      });
      continue;
    }
    const g = guesses.get(field.canonicalPath);
    const extra = notes.get(field.canonicalPath) ?? [];
    const reason = [
      g === undefined
        ? `No schema field found for ${field.canonicalPath}.`
        : `Best guess ${g.rawPath} at ${g.confidence} is below ${MIN_MAP_CONFIDENCE}. ${g.why}`,
      ...extra,
      input.schemaAssist === undefined ? 'Schema assist not configured.' : '',
    ]
      .filter((s) => s !== '')
      .join(' ');
    unmapped.push(unmappedField(field.canonicalPath, reason));
    const key: UnmappedKey =
      g === undefined
        ? { rawPath: field.canonicalPath, sampleValues: [], reason }
        : {
            rawPath: g.rawPath,
            sampleValues: [],
            reason,
            bestGuess: { canonicalPath: field.canonicalPath, confidence: g.confidence },
          };
    unmappedKeys.push(key);
  }

  const fieldMap: FieldMap = { entries, unmapped: unmappedKeys };
  return { located, unmapped, fieldMap, assistUsed };
}
