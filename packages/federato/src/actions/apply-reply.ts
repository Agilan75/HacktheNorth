/**
 * Turns a validated broker reply into `ExternalValue[]` with `answer`
 * provenance and reports what the underwriter still has to confirm.
 * Body owned by Run 1 unit F13.
 */
import type { CanonicalSubmission, ExternalValue, Field } from '@retrofit/engine';
import { math } from '@retrofit/engine';
import { truncateQuote } from '@retrofit/contracts';
import type { ReplyApplication, ScoreSnapshot, ValidatedFieldValue } from '../types';

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

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export function applyReply(input: ApplyReplyInput): ReplyApplication {
  const extracted = [...input.validated];
  const accepted = extracted.filter((v) => v.accepted);
  const needsConfirmation = extracted.filter((v) => !v.accepted && v.needsConfirmation);
  const rejected = extracted.filter((v) => !v.accepted && !v.needsConfirmation);

  // One value per path goes to the engine; `validateExtraction` has already
  // withheld paths whose clean values disagree, so the first is the value.
  const seen = new Set<string>();
  const externalValues: ExternalValue[] = [];
  for (const v of accepted) {
    if (seen.has(v.canonicalPath) || !present(v.value)) continue;
    seen.add(v.canonicalPath);
    externalValues.push({
      canonicalPath: v.canonicalPath,
      value: v.value,
      // Confidence is omitted on purpose: `answer` takes the fixed table's 0.8
      // (INTERPRETATIONS V-7), never the model's self-reported number.
      provenance: {
        source: 'answer',
        sourceDetail: `broker reply to ${input.submissionId}: "${truncateQuote(v.quote, 160)}"`,
      },
    });
  }

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
