/**
 * Turns a validated broker reply into `ExternalValue[]` with `answer`
 * provenance and reports what the underwriter still has to confirm.
 * Body owned by Run 1 unit F13.
 */
import type { CanonicalSubmission, ExternalValue, Field } from '@retrofit/engine';
import { math, merge } from '@retrofit/engine';
import { truncateQuote } from '@retrofit/contracts';
import type { ExtractionRejection, ReplyApplication, ScoreSnapshot, ValidatedFieldValue } from '../types';

export interface ApplyReplyInput {
  readonly submissionId: string;
  readonly sourceText: string;
  readonly validated: readonly ValidatedFieldValue[];
  readonly canonical: CanonicalSubmission;
  readonly before?: ScoreSnapshot | null;
}

/* -------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* -------------------------------------------------------------------------- */

type Bag = Readonly<Record<string, unknown>>;

const LISTS = new Set(['buildings', 'locations', 'history']);
const GROUPS = new Set(['insured', 'exposure', 'pricing']);
const HAZARD_DIRECT = new Set(['smokeDetectorCount', 'sprinklerHeadCount', 'ceilingObserved']);

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The `Sourced` slot a canonical path names, or null when the submission has none. */
function slotAt(canonical: CanonicalSubmission, path: string): readonly Field<unknown>[] | null {
  const seg = path.split('.').filter((s) => s.length > 0);
  const root = canonical as unknown as Bag;
  const head = seg[0] ?? '';
  let slot: unknown;

  if (seg.length === 1) {
    slot = root[head];
  } else if (seg.length === 2 && GROUPS.has(head)) {
    const group = root[head];
    slot = isBag(group) ? group[seg[1] ?? ''] : undefined;
  } else if (seg.length === 3 && LISTS.has(head)) {
    const list = root[head];
    const entry = Array.isArray(list)
      ? (list as readonly unknown[]).find((e) => isBag(e) && e['externalId'] === seg[1])
      : undefined;
    slot = isBag(entry) ? entry[seg[2] ?? ''] : undefined;
  } else if (head === 'hazards') {
    const hazards = root['hazards'];
    if (!isBag(hazards)) return null;
    const key = seg[seg.length - 1] ?? '';
    const present = hazards['present'];
    slot = HAZARD_DIRECT.has(key) ? hazards[key] : isBag(present) ? present[key] : undefined;
  } else {
    return null;
  }
  return Array.isArray(slot) ? (slot as readonly Field<unknown>[]) : null;
}

/** `Masonry Non-Combustible` and `masonry_non_combustible` are the same class (G-8). */
function normString(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function materiallyEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return math.approxEqual(a, b);
  if (typeof a === 'string' && typeof b === 'string') return normString(a) === normString(b);
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  // Sprinklered as 1/0 against a boolean.
  if (typeof a === 'boolean' && typeof b === 'number') return (a ? 1 : 0) === b;
  if (typeof a === 'number' && typeof b === 'boolean') return (b ? 1 : 0) === a;
  return JSON.stringify(a) === JSON.stringify(b);
}

function present(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  return true;
}

/**
 * A clean value the engine has no slot for (R-I4-2). `ExtractionRejection` is
 * frozen in types.ts and has no member for it yet; the DTO carries any string.
 * `'not_applied'` is a member of `ExtractionRejection` (added at Run 2, R2-7).
 */
const NOT_APPLIED: ExtractionRejection = 'not_applied';

/** Keys that hold no broker fact: skipped when counting what a merge wrote. */
const NOT_FACTS = new Set(['raw', 'fieldMap', 'rollup']);

/** Every `{ value, provenance }` field in the canonical facts. */
function countFields(node: unknown, top = true): number {
  if (Array.isArray(node)) return node.reduce((n: number, e: unknown) => n + countFields(e, false), 0);
  if (typeof node !== 'object' || node === null) return 0;
  const bag = node as Bag;
  if ('value' in bag && 'provenance' in bag) return 1;
  let n = 0;
  for (const [k, child] of Object.entries(bag)) {
    if (top && NOT_FACTS.has(k)) continue;
    n += countFields(child, false);
  }
  return n;
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export function applyReply(input: ApplyReplyInput): ReplyApplication {
  const extracted = [...input.validated];

  // One value per path goes to the engine; `validateExtraction` has already
  // withheld paths whose clean values disagree, so the first is the value.
  // Each is merged, in order, onto the canonical exactly as the re-score will
  // merge it: a value that writes no field would change nothing, so it is
  // reported as not applied instead of accepted (R-I4-2).
  const landed = new Set<string>();
  const unplaced = new Set<string>();
  const externalValues: ExternalValue[] = [];
  let working = input.canonical;
  let fields = countFields(working);
  for (const v of extracted) {
    if (!v.accepted || landed.has(v.canonicalPath) || unplaced.has(v.canonicalPath)) continue;
    if (!present(v.value)) {
      unplaced.add(v.canonicalPath);
      continue;
    }
    const ev: ExternalValue = {
      canonicalPath: v.canonicalPath,
      value: v.value,
      // Confidence is omitted on purpose: `answer` takes the fixed table's 0.8
      // (INTERPRETATIONS V-7), never the model's self-reported number.
      provenance: {
        source: 'answer',
        sourceDetail: `broker reply to ${input.submissionId}: "${truncateQuote(v.quote, 160)}"`,
      },
    };
    const next = merge(working, [], [], [ev]);
    const nextFields = countFields(next);
    if (nextFields > fields) {
      landed.add(v.canonicalPath);
      externalValues.push(ev);
      working = next;
      fields = nextFields;
    } else {
      unplaced.add(v.canonicalPath);
    }
  }
  for (let i = 0; i < extracted.length; i++) {
    const v = extracted[i];
    if (v === undefined || !v.accepted || !unplaced.has(v.canonicalPath)) continue;
    extracted[i] = { ...v, accepted: false, rejection: NOT_APPLIED, needsConfirmation: false };
  }

  const accepted = extracted.filter((v) => v.accepted);
  const needsConfirmation = extracted.filter((v) => !v.accepted && v.needsConfirmation);
  const rejected = extracted.filter((v) => !v.accepted && !v.needsConfirmation);

  return {
    submissionId: input.submissionId,
    sourceText: input.sourceText,
    extracted,
    accepted,
    rejected,
    needsConfirmation,
    externalValues,
    newContradictionPaths: conflictingPaths(accepted, input.canonical),
    before: input.before ?? null,
    // The engine re-run happens in the API; it fills `after`.
    after: null,
  };
}

/** Paths where the reply disagrees with what the broker first submitted. */
export function conflictingPaths(
  validated: readonly ValidatedFieldValue[],
  canonical: CanonicalSubmission,
): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of validated) {
    if (!v.accepted || !present(v.value) || seen.has(v.canonicalPath)) continue;
    const slot = slotAt(canonical, v.canonicalPath);
    if (slot === null) continue;
    const submitted = slot.filter((f) => f.provenance?.source === 'self_reported' && present(f.value));
    if (submitted.some((f) => !materiallyEqual(f.value, v.value))) {
      seen.add(v.canonicalPath);
      out.push(v.canonicalPath);
    }
  }
  return out;
}
