/** Broker reply: extract, validate, apply, re-score, log. Unit A17. */
import type {
  ExtractReplyFieldSpec,
  ExtractedValueDto,
  ReplyRequestDto,
  ReplyResponseDto,
  RequestedFieldDto,
  ScoreSnapshotDto,
} from '@retrofit/contracts';
import type { CanonicalSubmission, EngineResult, Severity, Sourced } from '@retrofit/engine';
import { merge, readVectorSpec } from '@retrofit/engine';
import { applyReply, selectRequest, validateExtraction } from '@retrofit/federato';
import type {
  ExtractedFieldValue,
  RequestSelection,
  RequestedField,
  ValidatedFieldValue,
} from '@retrofit/federato';
import { createRepos } from '../db/repos';
import type { Repos } from '../db/repos';
import type { ActionRow, SubmissionRow } from '../db/schema';
import { extractReplyCall } from '../llm/calls/extract-reply';
import type { LlmPdfPart } from '../llm/types';
import { actionDtoOf, newActionId } from './actions';
import { rescoreOne, snapshotOf } from './rescore';
import type { Deps } from './types';

/*
 * Decisions: docs/decisions/A17.md. In short:
 * - The fields a reply may answer are the answered action's fields; with no
 *   `actionId`, the latest request action's; with none at all, what F13's
 *   `selectRequest` would ask for today.
 * - Gemini (A06) extracts; F13's `validateExtraction` is the gate (type,
 *   range, quote in source, 0.8). A PDF cannot be read by code, so a PDF
 *   value that is clean but unquotable goes to the underwriter to confirm.
 * - Accepted values are merged into the stored canonical with `answer`
 *   provenance (so a later book re-score keeps them), then `rescoreOne`.
 * - One `reply` action logs source text, every extracted value and the
 *   before/after numbers; a `rescore` action logs the engine re-run when
 *   anything was applied; the answered request is marked `replied`.
 */

/* -------------------------------------------------------------------------- */
/* Private: field specs for extract-reply                                     */
/* -------------------------------------------------------------------------- */

/** The eight live `Building.construction_type` values (LIVE_DATA_FACTS). */
const CONSTRUCTION_TYPES = [
  'Fire Resistive',
  'Frame',
  'Non-Combustible',
  'Masonry Non-Combustible',
  'Joisted Masonry',
  'Modified Fire Resistive',
  'Wood Frame',
  'Steel Frame',
] as const;

type SpecShape = Omit<ExtractReplyFieldSpec, 'canonicalPath' | 'label'>;

const MONEY: SpecShape = { type: 'money', min: 0, unit: 'USD' };
const PERCENT: SpecShape = { type: 'percent', min: 0, max: 1 };

/** Keyed by the last path segment. Anything unlisted is a plain string. */
const LEAF_SPEC: Readonly<Record<string, SpecShape>> = {
  yearBuilt: { type: 'year' },
  roofYear: { type: 'year' },
  tiv: MONEY,
  totalTiv: MONEY,
  quotedPremium: MONEY,
  fiveYearLoss: MONEY,
  paidIndemnity: MONEY,
  paidExpense: MONEY,
  reserves: { type: 'money', unit: 'USD' },
  requestedLimit: MONEY,
  contentsLimit: MONEY,
  pctTivPre1990: PERCENT,
  pctTivPost2010: PERCENT,
  pctTivAcceptableConstruction: PERCENT,
  pctTivSprinklered: PERCENT,
  sprinklered: { type: 'boolean' },
  protectionClass: { type: 'number', min: 1, max: 10 },
  tivWeightedProtectionClass: { type: 'number', min: 1, max: 10 },
  stories: { type: 'number', min: 1, max: 200 },
  constructionType: { type: 'string', options: CONSTRUCTION_TYPES },
  submissionType: { type: 'string', options: ['new_business', 'renewal'] },
  state: { type: 'string' },
};

function leafOf(path: string): string {
  const seg = path.split('.');
  return seg[seg.length - 1] ?? path;
}

function specFor(field: RequestedFieldDto): ExtractReplyFieldSpec {
  const shape = LEAF_SPEC[leafOf(field.canonicalPath)] ?? { type: 'string' };
  return { canonicalPath: field.canonicalPath, label: field.label, ...shape };
}

/* -------------------------------------------------------------------------- */
/* Private: helpers                                                           */
/* -------------------------------------------------------------------------- */

function firstValue<T>(slot: Sourced<T> | undefined): T | null {
  if (slot === undefined) return null;
  for (const f of slot) if (f.value !== null && f.value !== undefined) return f.value;
  return null;
}

function toRequestedField(f: RequestedFieldDto): RequestedField {
  return { ...f, factor: f.factor as RequestedField['factor'], severity: f.severity as Severity };
}

interface Asked {
  readonly fields: readonly RequestedFieldDto[];
  readonly answers: ActionRow | null;
}

/** Which fields this reply may answer. */
function askedFields(repos: Repos, row: SubmissionRow, result: EngineResult, actionId: string | undefined): Asked {
  if (actionId !== undefined) {
    const action = repos.actions.byId(actionId);
    if (action === null) throw new Error(`reply: no action "${actionId}"`);
    if (action.submissionId !== row.id) {
      throw new Error(`reply: action "${actionId}" belongs to submission "${action.submissionId}"`);
    }
    return { fields: action.payload.fields ?? [], answers: action };
  }
  const requests = repos.actions
    .list({ submissionId: row.id, type: 'request' })
    .rows.filter((a) => a.status !== 'failed' && (a.payload.fields ?? []).length > 0);
  const open = requests.find((a) => a.status === 'sent' || a.status === 'approved') ?? requests[0];
  if (open !== undefined) return { fields: open.payload.fields ?? [], answers: open };
  const sel = selectRequest({ submissionId: row.id, result, insuredName: row.insuredName ?? null });
  return { fields: sel.fields.map((f) => ({ ...f })), answers: null };
}

function selectionOf(submissionId: string, fields: readonly RequestedFieldDto[]): RequestSelection {
  return {
    submissionId,
    triggers: [],
    fields: fields.map(toRequestedField),
    insuredName: null,
    broker: null,
    contact: null,
    rationale: '',
    qualifies: fields.length > 0,
  };
}

/**
 * Code cannot read a PDF, so a PDF value whose only fault is an unquotable
 * sentence is not thrown away: it goes to the underwriter (A06 D5).
 */
function pdfToConfirmation(v: ValidatedFieldValue): ValidatedFieldValue {
  if (v.accepted || v.rejection !== 'quote_not_found' || !v.typeOk || !v.rangeOk) return v;
  return { ...v, rejection: 'low_confidence', needsConfirmation: true };
}

function dto(v: ValidatedFieldValue): ExtractedValueDto {
  return {
    canonicalPath: v.canonicalPath,
    value: v.value,
    confidence: v.confidence,
    quote: v.quote,
    accepted: v.accepted,
    quoteFound: v.quoteFound,
    typeOk: v.typeOk,
    rangeOk: v.rangeOk,
    rejection: v.rejection,
    needsConfirmation: v.needsConfirmation,
  };
}

function describeSource(request: ReplyRequestDto): string {
  const text = request.text ?? '';
  if (request.pdfBase64 === undefined) return text;
  const pdf = `[PDF attached${request.filename ? `: ${request.filename}` : ''}]`;
  return text.trim() === '' ? pdf : `${text}\n\n${pdf}`;
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export async function applyBrokerReply(
  deps: Deps,
  submissionId: string,
  request: ReplyRequestDto,
): Promise<ReplyResponseDto> {
  const repos = createRepos(deps.db);
  const row = repos.submissions.byId(submissionId);
  if (row === null) throw new Error(`reply: no submission "${submissionId}"`);
  const stored = row.result;
  const canonical: CanonicalSubmission | null = row.canonical ?? null;
  if (stored === null || stored === undefined || canonical === null) {
    throw new Error(`reply: submission "${submissionId}" has not been scored`);
  }
  const before: ScoreSnapshotDto = snapshotOf(stored, row.rank ?? null);
  const insuredName = row.insuredName ?? firstValue(canonical.insured.name) ?? null;
  const asked = askedFields(repos, row, stored, request.actionId);

  /* 1. Extract (Gemini reads; code checks). */
  const text = request.text ?? '';
  const pdf: LlmPdfPart | undefined =
    request.pdfBase64 === undefined
      ? undefined
      : {
          kind: 'pdf',
          mimeType: 'application/pdf',
          dataBase64: request.pdfBase64,
          ...(request.filename === undefined ? {} : { filename: request.filename }),
        };
  const extraction = await extractReplyCall(
    deps.llm,
    {
      sourceText: text.trim() === '' ? null : text,
      requestedFields: asked.fields.map(specFor),
      insuredName,
    },
    pdf,
  );

  /* 2. Validate: type, range, quote in source, the 0.8 gate (F13). */
  const extracted: ExtractedFieldValue[] = extraction.values.map((v) => ({
    canonicalPath: v.canonicalPath,
    value: v.value,
    confidence: v.confidence,
    quote: v.quote,
  }));
  const spec = await readVectorSpec(row.lineOfBusiness);
  let validated = validateExtraction({
    extracted,
    requested: selectionOf(row.id, asked.fields),
    spec,
    sourceText: text,
  });
  if (pdf !== undefined) validated = validated.map(pdfToConfirmation);

  /* 3. Apply: answer-provenance values and the contradictions they raise. */
  const application = applyReply({
    submissionId: row.id,
    sourceText: describeSource(request),
    validated,
    canonical,
    before,
  });

  /* 4. Re-score when anything was accepted. */
  let result: EngineResult = stored;
  let after: ScoreSnapshotDto = before;
  const nowIso = deps.clock.nowIso();
  if (application.externalValues.length > 0) {
    const answered = merge(canonical, [], [], application.externalValues);
    repos.submissions.update(row.id, { canonical: answered, updatedAt: nowIso });
    const rescored = await rescoreOne(deps, { submissionId: row.id });
    result = rescored.result;
    after = rescored.after;
  }

  const beforeIds = new Set(stored.contradictions.map((c) => c.id));
  const raisedPaths = new Set(application.newContradictionPaths);
  const newContradictions = result.contradictions.filter(
    (c) => c.status === 'open' && (!beforeIds.has(c.id) || raisedPaths.has(c.canonicalPath)),
  );

  /* 5. Log. */
  const extractedDto = application.extracted.map(dto);
  const acceptedDto = application.accepted.map(dto);
  const rejectedDto = application.rejected.map(dto);
  const confirmDto = application.needsConfirmation.map(dto);
  const noteParts = [
    `${acceptedDto.length} accepted, ${confirmDto.length} to confirm, ${rejectedDto.length} rejected` +
      (extraction.notFound.length > 0 ? `; not answered: ${extraction.notFound.join(', ')}` : '') +
      '.',
    newContradictions.length > 0
      ? `The reply disagrees with the submission on ${newContradictions.map((c) => c.canonicalPath).join(', ')}.`
      : null,
  ];
  const replyRow = repos.actions.insert({
    id: newActionId('reply'),
    submissionId: row.id,
    type: 'reply',
    status: acceptedDto.length > 0 ? 'applied' : 'replied',
    actor: 'gemini:extract-reply',
    payload: {
      fields: [...asked.fields],
      extracted: extractedDto,
      rankBefore: before.rank,
      rankAfter: after.rank,
      note: noteParts.filter((s) => s !== null).join(' '),
    },
    before,
    after,
    sourceText: application.sourceText,
    createdAt: nowIso,
  });
  if (acceptedDto.length > 0) {
    repos.actions.insert({
      id: newActionId('rescore'),
      submissionId: row.id,
      type: 'rescore',
      status: 'applied',
      actor: 'code',
      payload: {
        rankBefore: before.rank,
        rankAfter: after.rank,
        note: `Re-scored after the broker reply (${application.externalValues.map((v) => v.canonicalPath).join(', ')}).`,
      },
      before,
      after,
      sourceText: null,
      createdAt: nowIso,
    });
  }
  if (asked.answers !== null && asked.answers.status !== 'replied') {
    repos.actions.update(asked.answers.id, { status: 'replied' });
  }

  const fresh = repos.submissions.byId(row.id) ?? row;
  return {
    id: row.id,
    action: actionDtoOf(replyRow, fresh),
    extracted: extractedDto,
    accepted: acceptedDto,
    rejected: rejectedDto,
    needsConfirmation: confirmDto,
    newContradictions,
    before,
    after,
    rankBefore: before.rank,
    rankAfter: after.rank,
    result,
  };
}
