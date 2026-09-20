import { useId, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactElement } from 'react';

import { formatPercent, formatScore, formatVerdict } from '@retrofit/contracts';

import { Badge } from '../components/atoms/Badge.js';
import type { ActionLogEntryView, ExtractedFieldView, ReplyBoxProps, ReplyResultView } from './types.js';

/** Mirrors `MIN_EXTRACTION_CONFIDENCE` (PRD 7.6: accepted at ≥ 0.8). Label text only; `accepted` decides. */
const MIN_EXTRACTION_CONFIDENCE = 0.8;

const ACCEPT_FILES = '.pdf,.txt,.eml,.md,application/pdf,text/plain';

function fieldStatus(field: ExtractedFieldView): string {
  if (field.accepted) return 'Accepted';
  if (field.rejectedReason !== null && field.rejectedReason.trim() !== '') return field.rejectedReason;
  return `Needs confirmation (under ${formatPercent(MIN_EXTRACTION_CONFIDENCE)})`;
}

function FieldsTable(props: { readonly fields: readonly ExtractedFieldView[] }): ReactElement {
  if (props.fields.length === 0) {
    return <p className="rf-empty">No field values were found in the reply.</p>;
  }
  return (
    <div className="rf-scroll-x">
    <table className="rf-table" aria-label="Extracted fields">
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Value</th>
          <th scope="col">Confidence</th>
          <th scope="col">Status</th>
          <th scope="col">Quoted from the reply</th>
        </tr>
      </thead>
      <tbody>
        {props.fields.map((f) => (
          <tr key={f.path} data-testid="reply-field" data-accepted={f.accepted ? 'true' : 'false'}>
            <th scope="row">
              {f.label}
              <br />
              <code>{f.path}</code>
            </th>
            <td>{f.value}</td>
            <td>{formatPercent(f.confidence)}</td>
            <td>
              <Badge label={fieldStatus(f)} tone={f.accepted ? 'quiet' : 'attention'} />
            </td>
            <td>
              <blockquote className="rf-citation__quote">{`“${f.quote}”`}</blockquote>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function snapshot(entry: ActionLogEntryView | null): string {
  if (entry === null) return '—';
  const score = formatScore(entry.afterScore ?? entry.beforeScore);
  const rank = formatScore(entry.afterRank ?? entry.beforeRank);
  const verdict = formatVerdict(entry.afterVerdict ?? entry.beforeVerdict);
  return `score ${score}, rank ${rank}, ${verdict}`;
}

function Movement(props: { readonly result: ReplyResultView }): ReactElement | null {
  const { before, after } = props.result;
  if (before === null && after === null) return null;
  return (
    <dl className="rf-stats" data-testid="reply-movement">
      <div className="rf-stat" data-testid="reply-before">
        <dt>Before the reply</dt>
        <dd>{snapshot(before)}</dd>
      </div>
      <div className="rf-stat" data-testid="reply-after">
        <dt>After the reply</dt>
        <dd>{snapshot(after)}</dd>
      </div>
    </dl>
  );
}

/**
 * PRD 10 (k) Paste or upload the broker reply; shows extracted fields with quotes.
 *
 * Gemini extracts and code validates on the server; this box only sends text
 * or a file and renders the typed result it gets back.
 */
export function ReplyBox(props: ReplyBoxProps): ReactElement {
  const { submissionId, result, pending, onSubmitText, onSubmitFile } = props;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textId = useId();
  const fileId = useId();
  const trimmed = text.trim();

  const run = async (fn: () => void | Promise<void>, onOk?: () => void): Promise<void> => {
    setError(null);
    try {
      await fn();
      onOk?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (trimmed === '' || pending) return;
    void run(
      () => onSubmitText(trimmed),
      () => setText(''),
    );
  };

  const pick = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (file === undefined || pending) return;
    void run(
      () => onSubmitFile(file),
      () => {
        input.value = '';
      },
    );
  };

  return (
    <div className="rf-reply" data-testid="reply-box" data-submission-id={submissionId}>
      <h3 className="rf-card__subtitle">Broker reply</h3>
      <form
        onSubmit={submit}
        aria-busy={pending}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rf-space-md)', maxWidth: 640 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rf-space-xs)' }}>
          <label htmlFor={textId}>Paste the broker&apos;s reply</label>
          <textarea
            id={textId}
            rows={6}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            disabled={pending}
            placeholder="e.g. Building B-1 was built in 1991 per the county assessor."
            style={{ width: '100%' }}
          />
        </div>
        <button
          type="submit"
          className="rf-button rf-button--primary"
          disabled={pending || trimmed === ''}
          style={{ alignSelf: 'flex-start' }}
        >
          {pending ? 'Extracting…' : 'Extract fields'}
        </button>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 'var(--rf-space-sm)',
            paddingTop: 'var(--rf-space-sm)',
            borderTop: '1px solid var(--rf-muted-tint)',
          }}
        >
          <label htmlFor={fileId}>Or upload a reply (PDF or text, e.g. loss runs)</label>
          <input id={fileId} type="file" accept={ACCEPT_FILES} onChange={pick} disabled={pending} />
        </div>
      </form>
      <p aria-live="polite" className="rf-footnote">
        {pending ? 'Reading the reply…' : ''}
      </p>
      {error !== null ? (
        <p role="alert" className="rf-error">
          {`Reply failed: ${error}`}
        </p>
      ) : null}
      {result !== null ? (
        <div className="rf-reply__result" data-testid="reply-result">
          <FieldsTable fields={result.fields} />
          <Movement result={result} />
        </div>
      ) : null}
    </div>
  );
}
