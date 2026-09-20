/** Routing plus request drafting for every qualifying account. Unit A17. */
import { randomUUID } from 'node:crypto';
import type {
  ActionDto,
  ActionsPlanRequestDto,
  ActionsPlanResponseDto,
  DecisionDto,
  DecisionResponseDto,
  DraftRequestInput,
  DraftRequestOutput,
  RequestedFieldDto,
  RoutingDecisionDto,
} from '@retrofit/contracts';
import type { EngineResult, Sourced } from '@retrofit/engine';
import { route, selectRequest, validateDraft } from '@retrofit/federato';
import type {
  BrokerRecord,
  ContactRecord,
  FederatoRecord,
  RequestSelection,
  UnderwriterRecord,
} from '@retrofit/federato';
import { createRepos } from '../db/repos';
import type { Repos } from '../db/repos';
import type { ActionPayload, ActionRow, SubmissionRow } from '../db/schema';
import { draftRequestCall, templateDraft } from '../llm/calls/draft-request';
import { LlmError } from '../llm/types';
import { snapshotOf } from './rescore';
import type { Deps } from './types';

/** Live Gemini drafts in flight at once during /actions/plan (DECISIONS S1-1). */
const DRAFT_CONCURRENCY = 8;

/*
 * Decisions: docs/decisions/A17.md. In short:
 * - Scope is every scored commercial-property row (optionally narrowed to
 *   `externalIds`). Routing covers the accounts the engine did not knock out;
 *   request selection is F13's `selectRequest` on every scored account.
 * - Re-planning is idempotent: the latest route row and the latest draft
 *   request of an account are updated in place, never duplicated; a request
 *   already approved or sent for the same fields is not drafted again.
 * - The underwriter, broker and contact directory comes from the adapter
 *   (Federato's read API); if it fails, routing flags senior referral and the
 *   draft greets without names.
 * - A draft Gemini cannot produce (degraded, unavailable, or failing F13's
 *   draft validator) falls back to the deterministic template; the actor says
 *   which wrote it.
 */

/* -------------------------------------------------------------------------- */
/* Private: records                                                           */
/* -------------------------------------------------------------------------- */

const SENT_NOTE = 'Marked sent. Nothing is emailed: the dataset contacts are synthetic (PRD 7.6).';

interface Directory {
  readonly underwriters: readonly UnderwriterRecord[];
  readonly brokers: ReadonlyMap<number, BrokerRecord>;
  readonly contacts: ReadonlyMap<number, ContactRecord>;
  /** externalId -> { brokerId, contactId, requestedLimit } from the Submission row. */
  readonly submissions: ReadonlyMap<string, SubmissionRef>;
  readonly note: string | null;
}

interface SubmissionRef {
  readonly brokerId: number | null;
  readonly contactId: number | null;
  readonly requestedLimit: number | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A reference is a numeric id, or the expanded object carrying one. */
function refId(v: unknown): number | null {
  if (typeof v === 'number') return num(v);
  if (typeof v === 'object' && v !== null) return num((v as Record<string, unknown>)['id']);
  return null;
}

function underwriterOf(r: FederatoRecord): UnderwriterRecord | null {
  const id = num(r['id']);
  const name = str(r['name']);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    email: str(r['email']) ?? '',
    team: str(r['team']) ?? '',
    region: str(r['region']) ?? '',
    authorityLimit: num(r['authority_limit']) ?? Number.NaN,
  };
}

function brokerOf(r: FederatoRecord): BrokerRecord | null {
  const id = num(r['id']);
  const name = str(r['name']);
  if (id === null || name === null) return null;
  return { id, name, tier: str(r['tier']) ?? '', region: str(r['region']) ?? '' };
}

function contactOf(r: FederatoRecord): ContactRecord | null {
  const id = num(r['id']);
  const name = str(r['name']);
  if (id === null || name === null) return null;
  return { id, name, email: str(r['email']) ?? '', phone: str(r['phone']) ?? '', title: str(r['title']) };
}

function byIdMap<T extends { readonly id: number }>(rows: readonly FederatoRecord[], of: (r: FederatoRecord) => T | null): Map<number, T> {
  const out = new Map<number, T>();
  for (const r of rows) {
    const rec = of(r);
    if (rec !== null && !out.has(rec.id)) out.set(rec.id, rec);
  }
  return out;
}

async function loadDirectory(deps: Deps, externalIds: readonly string[]): Promise<Directory> {
  try {
    const page = { pagination: { limit: 500 } } as const;
    const [uw, br, ct, subs] = await Promise.all([
      deps.adapter.query({ resource: 'Underwriter', ...page }),
      deps.adapter.query({ resource: 'Broker', ...page }),
      deps.adapter.query({ resource: 'Contact', ...page }),
      externalIds.length === 0
        ? Promise.resolve({ results: [] as readonly FederatoRecord[] })
        : deps.adapter.query({
            resource: 'Submission',
            where: { submission_number: { $in: [...externalIds] } },
            pagination: { limit: 500 },
          }),
    ]);
    const submissions = new Map<string, SubmissionRef>();
    for (const s of subs.results) {
      const ext = str(s['submission_number']);
      if (ext === null) continue;
      submissions.set(ext, {
        brokerId: refId(s['broker']),
        contactId: refId(s['contact']),
        requestedLimit: num(s['requested_limit']),
      });
    }
    return {
      underwriters: [...byIdMap(uw.results, underwriterOf).values()],
      brokers: byIdMap(br.results, brokerOf),
      contacts: byIdMap(ct.results, contactOf),
      submissions,
      note: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      underwriters: [],
      brokers: new Map(),
      contacts: new Map(),
      submissions: new Map(),
      note: `Underwriter and broker directory unavailable: ${message}`,
    };
  }
}

function firstValue<T>(slot: Sourced<T> | undefined): T | null {
  if (slot === undefined) return null;
  for (const f of slot) if (f.value !== null && f.value !== undefined) return f.value;
  return null;
}

function insuredNameOf(row: SubmissionRow, result: EngineResult): string | null {
  return row.insuredName ?? firstValue(result.canonical.insured.name) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Private: DTO                                                               */
/* -------------------------------------------------------------------------- */

/** Stored action -> wire shape. Shared with the reply service (same unit). */
export function actionDtoOf(row: ActionRow, submission: SubmissionRow | null): ActionDto {
  const p: ActionPayload = row.payload ?? {};
  return {
    id: row.id,
    submissionId: row.submissionId,
    externalId: submission?.externalId ?? null,
    insuredName: submission?.insuredName ?? null,
    type: row.type,
    status: row.status,
    actor: row.actor,
    triggers: [...(p.triggers ?? [])],
    fields: [...(p.fields ?? [])],
    draft: p.draft ?? null,
    recipient: p.recipient ?? null,
    routing: p.routing ?? null,
    sourceText: row.sourceText ?? null,
    extracted: [...(p.extracted ?? [])],
    before: row.before ?? null,
    after: row.after ?? null,
    rankBefore: p.rankBefore ?? null,
    rankAfter: p.rankAfter ?? null,
    note: p.note ?? null,
    decision: p.decision ?? null,
    createdAt: row.createdAt,
  };
}

/** A new action id. Ids are opaque; the clock orders rows, not the id. */
export function newActionId(type: string): string {
  return `act_${type}_${randomUUID()}`;
}

function latest(repos: Repos, submissionId: string, type: 'route' | 'request'): readonly ActionRow[] {
  return repos.actions.list({ submissionId, type }).rows;
}

const pathKey = (fields: readonly { readonly canonicalPath: string }[]): string =>
  fields.map((f) => f.canonicalPath).sort().join('|');

/* -------------------------------------------------------------------------- */
/* Private: drafting                                                          */
/* -------------------------------------------------------------------------- */

interface Drafted {
  readonly draft: DraftRequestOutput | null;
  readonly actor: string;
  readonly note: string | null;
}

function draftInput(sel: RequestSelection): DraftRequestInput {
  return {
    insuredName: sel.insuredName,
    brokerName: sel.broker?.name ?? null,
    contactName: sel.contact?.name ?? null,
    fields: sel.fields.map((f) => ({ canonicalPath: f.canonicalPath, label: f.label, why: f.why })),
    tone: 'short_and_specific',
  };
}

const sameDraft = (a: DraftRequestOutput, b: DraftRequestOutput): boolean =>
  a.subject === b.subject && a.body === b.body;

async function draftFor(deps: Deps, sel: RequestSelection, draftsOff: boolean): Promise<Drafted> {
  if (draftsOff) return { draft: null, actor: 'code', note: 'Drafts off: the field list only.' };
  const input = draftInput(sel);
  const template = templateDraft(input);
  let draft: DraftRequestOutput;
  let note: string | null = null;
  try {
    draft = await draftRequestCall(deps.llm, input);
  } catch (error) {
    // One account's draft never sinks the whole plan: the template always passes.
    if (!(error instanceof LlmError)) throw error;
    draft = template;
    note = `Gemini draft unavailable (${error.message}); template used.`;
  }
  let actor = sameDraft(draft, template) ? 'code' : 'llm:draft-request';

  // Second, independent check (F13): every field named, nothing else asked.
  const check = validateDraft(sel, `${draft.subject}\n\n${draft.body}`);
  if (!check.ok && actor !== 'code') {
    draft = template;
    actor = 'code';
    note = `Gemini draft failed the field check (${check.problems.join(' ')}); template used.`;
  } else if (!check.ok) {
    note = [note, `Draft check: ${check.problems.join(' ')}`].filter((s) => s !== null).join(' ');
  }
  return { draft, actor, note };
}

function recipientOf(sel: RequestSelection): ActionPayload['recipient'] {
  if (sel.contact === null && sel.broker === null) return null;
  return {
    name: sel.contact?.name ?? null,
    email: sel.contact?.email === '' ? null : (sel.contact?.email ?? null),
    brokerName: sel.broker?.name ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export async function planActions(
  deps: Deps,
  request: ActionsPlanRequestDto,
): Promise<ActionsPlanResponseDto> {
  const repos = createRepos(deps.db);
  const wanted = request.externalIds === undefined ? null : new Set(request.externalIds);
  const rows = repos.submissions
    .all()
    .filter((r) => r.lineOfBusiness === 'commercial_property')
    .filter((r) => wanted === null || wanted.has(r.externalId));

  const directory = await loadDirectory(
    deps,
    rows.map((r) => r.externalId),
  );
  const nowIso = deps.clock.nowIso();

  // Draft every qualifying request up front, DRAFT_CONCURRENCY at a time, then
  // let the loop below consume them in order. The loop used to await each
  // Gemini draft serially: 11 drafts took ~115 s against the live API, far too
  // long for a live demo. Ordering, writes and the result are unchanged.
  // DECISIONS S1-1.
  const draftsAhead = new Map<string, Promise<Awaited<ReturnType<typeof draftFor>>>>();
  {
    const pending: { id: string; run: () => Promise<Awaited<ReturnType<typeof draftFor>>> }[] = [];
    for (const row of rows) {
      const result = row.result;
      if (result === null || result === undefined) continue;
      const ref = directory.submissions.get(row.externalId) ?? null;
      const broker = ref?.brokerId == null ? null : (directory.brokers.get(ref.brokerId) ?? null);
      const contact = ref?.contactId == null ? null : (directory.contacts.get(ref.contactId) ?? null);
      const sel = selectRequest({ submissionId: row.id, result, insuredName: insuredNameOf(row, result), broker, contact });
      if (!sel.qualifies || sel.fields.length === 0) continue;
      const fields: RequestedFieldDto[] = sel.fields.map((f) => ({ ...f }));
      const asked = latest(repos, row.id, 'request').some(
        (a) => (a.status === 'approved' || a.status === 'sent') && pathKey(a.payload.fields ?? []) === pathKey(fields),
      );
      if (asked) continue;
      if (reusableDraft(repos, row.id, fields) !== undefined) continue;
      pending.push({ id: row.id, run: () => draftFor(deps, sel, request.draftsOff === true) });
    }
    let next = 0;
    const settle = new Map<string, (v: Awaited<ReturnType<typeof draftFor>>) => void>();
    const fail = new Map<string, (e: unknown) => void>();
    for (const p of pending) {
      const ahead = new Promise<Awaited<ReturnType<typeof draftFor>>>((res, rej) => { settle.set(p.id, res); fail.set(p.id, rej); });
      ahead.catch(() => undefined); // observed when the loop awaits it; never an unhandled rejection
      draftsAhead.set(p.id, ahead);
    }
    const worker = async (): Promise<void> => {
      while (next < pending.length) {
        const job = pending[next++]!;
        try { settle.get(job.id)!(await job.run()); } catch (e) { fail.get(job.id)!(e); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(DRAFT_CONCURRENCY, pending.length) }, worker));
  }

  let routed = 0;
  let needsSeniorReferral = 0;
  let drafted = 0;
  let skipped = 0;
  const out: ActionDto[] = [];

  for (const row of rows) {
    const result = row.result;
    if (result === null || result === undefined) {
      skipped += 1;
      continue;
    }
    const snapshot = snapshotOf(result, row.rank ?? null);
    const ref = directory.submissions.get(row.externalId) ?? null;
    const broker = ref?.brokerId == null ? null : (directory.brokers.get(ref.brokerId) ?? null);
    const contact = ref?.contactId == null ? null : (directory.contacts.get(ref.contactId) ?? null);
    const insuredName = insuredNameOf(row, result);

    /* Route: any account the engine did not knock out (PRD 7.6). */
    if (!result.evaluate.knockout) {
      const requestedLimit = firstValue(result.canonical.exposure.requestedLimit) ?? ref?.requestedLimit ?? null;
      const decision = route({
        submissionId: row.id,
        primaryState: result.rollup.primaryState,
        requestedLimit,
        underwriters: directory.underwriters,
      });
      const routing: RoutingDecisionDto = decision;
      if (decision.needsSeniorReferral) needsSeniorReferral += 1;
      else routed += 1;
      const payload: ActionPayload = {
        routing,
        note: decision.needsSeniorReferral
          ? ['Needs referral to senior authority.', directory.note].filter((s) => s !== null).join(' ')
          : directory.note,
      };
      const existing = latest(repos, row.id, 'route')[0];
      const saved =
        existing === undefined
          ? repos.actions.insert({
              id: newActionId('route'),
              submissionId: row.id,
              type: 'route',
              status: 'applied',
              actor: 'code',
              payload,
              before: snapshot,
              after: snapshot,
              sourceText: null,
              createdAt: nowIso,
            })
          : repos.actions.update(existing.id, { payload, before: snapshot, after: snapshot, status: 'applied' });
      out.push(actionDtoOf(saved, row));
    }

    /* Request: code picks the fields, Gemini drafts the wording. */
    const sel = selectRequest({ submissionId: row.id, result, insuredName, broker, contact });
    if (!sel.qualifies || sel.fields.length === 0) {
      skipped += 1;
      continue;
    }
    const fields: RequestedFieldDto[] = sel.fields.map((f) => ({ ...f }));
    const requests = latest(repos, row.id, 'request');
    const openDraft = requests.find((a) => a.status === 'draft');
    const alreadyAsked = requests.find(
      (a) => (a.status === 'approved' || a.status === 'sent') && pathKey(a.payload.fields ?? []) === pathKey(fields),
    );
    if (alreadyAsked !== undefined) {
      skipped += 1;
      out.push(actionDtoOf(alreadyAsked, row));
      continue;
    }

    // An open draft that already asks for exactly these fields is kept as is:
    // re-planning is idempotent and never re-spends a Gemini call (S1-1).
    const kept = reusableDraft(repos, row.id, fields);
    if (kept !== undefined) {
      drafted += 1;
      out.push(actionDtoOf(kept, row));
      continue;
    }
    const d = await (draftsAhead.get(row.id) ?? draftFor(deps, sel, request.draftsOff === true));
    const payload: ActionPayload = {
      triggers: [...sel.triggers],
      fields,
      draft: d.draft?.body ?? null,
      subject: d.draft?.subject ?? null,
      recipient: recipientOf(sel),
      routing: null,
      note: [sel.rationale, d.note].filter((s) => s !== null && s !== '').join(' '),
    };
    const saved =
      openDraft === undefined
        ? repos.actions.insert({
            id: newActionId('request'),
            submissionId: row.id,
            type: 'request',
            status: 'draft',
            actor: d.actor,
            payload,
            before: snapshot,
            after: null,
            sourceText: null,
            createdAt: nowIso,
          })
        : repos.actions.update(openDraft.id, { payload, actor: d.actor, before: snapshot });
    drafted += 1;
    out.push(actionDtoOf(saved, row));
  }

  return { routed, needsSeniorReferral, drafted, skipped, actions: out };
}

/** An open draft whose requested fields are unchanged and whose body exists. */
function reusableDraft(
  repos: ReturnType<typeof createRepos>,
  submissionId: string,
  fields: readonly RequestedFieldDto[],
) {
  return latest(repos, submissionId, 'request').find(
    (a) => a.status === 'draft' && a.payload.draft != null && pathKey(a.payload.fields ?? []) === pathKey(fields),
  );
}

/** Approving marks a draft sent. Nothing is ever really emailed (PRD §7.6). */
export async function approveAction(deps: Deps, actionId: string): Promise<ActionDto> {
  const repos = createRepos(deps.db);
  const row = repos.actions.byId(actionId);
  if (row === null) throw new Error(`approveAction: no action "${actionId}"`);
  if (row.status !== 'draft') {
    throw new Error(`approveAction: action "${actionId}" is "${row.status}"; only a draft can be approved`);
  }
  const prior = row.payload.note ?? null;
  const updated = repos.actions.update(actionId, {
    status: 'sent',
    payload: {
      ...row.payload,
      note: [prior, `${SENT_NOTE} Approved ${deps.clock.nowIso()}.`].filter((s) => s !== null && s !== '').join(' '),
    },
  });
  return actionDtoOf(updated, repos.submissions.byId(updated.submissionId));
}

/* -------------------------------------------------------------------------- */
/* Underwriter decisions (accept / decline)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Records what an underwriter decided to do about the engine's verdict.
 *
 * The decision is stored as an action **beside** the result, never over it: the
 * verdict, its deciding rule, the appetite score and the rank are exactly what
 * the engine computed, before and after. That is deliberate. The value of this
 * system is that a number can be traced to a guideline row, and a verdict a
 * person could quietly overwrite would not be traceable to anything. So the
 * account page ends up saying both things — what the rulebook concluded, and
 * what the underwriter did — and never conflates them.
 *
 * The engine is not re-run: nothing about the risk changed, only the human
 * response to it. The snapshot is taken so the log says what the decision was
 * taken *against*, which matters when a later reply re-scores the account.
 */
export function decideSubmission(
  deps: Deps,
  submissionId: string,
  input: { readonly decision: DecisionDto; readonly reason?: string },
): DecisionResponseDto {
  const repos = createRepos(deps.db);
  const row = repos.submissions.byId(submissionId);
  if (row === null) throw new Error(`decideSubmission: no submission "${submissionId}"`);
  const result = row.result;
  if (result === null || result === undefined) {
    throw new Error(`decideSubmission: submission "${submissionId}" has not been scored yet`);
  }

  const snapshot = snapshotOf(result, row.rank ?? null);
  const reason = input.reason?.trim();
  const verb = input.decision === 'accept' ? 'Accepted' : 'Declined';
  const note =
    reason === undefined || reason === ''
      ? `${verb} by the underwriter on ${deps.clock.nowIso()}. The engine said ${result.verdict.verdict}; that verdict is unchanged.`
      : `${verb} by the underwriter on ${deps.clock.nowIso()}: ${reason} The engine said ${result.verdict.verdict}; that verdict is unchanged.`;

  const action = repos.actions.insert({
    id: newActionId(input.decision),
    submissionId,
    type: 'decision',
    // Terminal by construction: a decision is not a draft awaiting approval.
    status: 'applied',
    actor: 'underwriter',
    payload: {
      note,
      decision: input.decision,
      ...(reason === undefined || reason === '' ? {} : { draft: reason }),
    },
    // Same on both sides on purpose: a decision moves no score.
    before: snapshot,
    after: snapshot,
    createdAt: deps.clock.nowIso(),
  });

  return {
    id: submissionId,
    decision: input.decision,
    engineVerdict: result.verdict.verdict,
    action: actionDtoOf(action, row),
  };
}
