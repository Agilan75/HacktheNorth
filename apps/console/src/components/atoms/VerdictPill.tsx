import type { ReactElement } from 'react';

import { VERDICT_MARKS, VERDICT_STYLES } from '@retrofit/design';

import type { Verdict } from '../../panels/types.js';

export interface VerdictPillProps {
  readonly verdict: Verdict;
  /** Optional trailing text, e.g. the deciding factor. Never replaces the verdict word. */
  readonly detail?: string;
}

const VARIANT_CLASS: Readonly<Record<Verdict, string>> = {
  FIT: 'rf-pill--fit',
  REFER: 'rf-pill--refer',
  DOES_NOT_FIT: 'rf-pill--does-not-fit',
};

/**
 * PRD 13: FIT is a red filled pill, REFER red outlined, DOES_NOT_FIT ink filled. The verdict word is always rendered as text, because colour never carries meaning alone.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function VerdictPill(props: VerdictPillProps): ReactElement {
  const { verdict, detail } = props;
  const style = VERDICT_STYLES[verdict];
  const trimmed = detail?.trim();
  return (
    <span
      className={`rf-pill ${VARIANT_CLASS[verdict]}`}
      data-verdict={verdict}
      data-variant={style.variant}
      title={trimmed ? `${style.label}: ${trimmed}` : style.label}
    >
      <span className="rf-pill__mark" aria-hidden="true">
        {VERDICT_MARKS[verdict]}
      </span>
      <span className="rf-pill__word">{style.short}</span>
      <span className="rf-sr-only">{` (${style.label})`}</span>
      {trimmed ? <span className="rf-pill__detail">{` · ${trimmed}`}</span> : null}
    </span>
  );
}
