import type { ReactElement } from 'react';
import type { FactorRowView, SubmissionFactsView } from './types.js';
/**
 * A line-of-business code as a reader sees it: `cyber` -> `Cyber`,
 * `commercial_property` -> `Commercial property`. Federato's short codes
 * (`cgl`, `lpl`) are shown upper-case as codes; nothing in the dataset or the
 * guidelines spells them out, so no expansion is guessed (FILL-console D4).
 */
export declare function lineOfBusinessLabel(line: string | null | undefined): string;
export interface AccountFactsProps {
    readonly accountKind: 'triage_knockout' | 'no_policy';
    /** The DTO's `displayLineOfBusiness`: Federato's own line on a knockout. */
    readonly displayLineOfBusiness: string;
    /** Null when the API predates the facts. */
    readonly facts: SubmissionFactsView | null;
    /** The engine's factor rows: which were assessed and which are missing. */
    readonly factors: readonly FactorRowView[];
    /** Anchor of the query-trace panel, so the reader can see the query that read these facts. */
    readonly traceAnchor: string;
}
/**
 * The lead of a sparse account page (a triage knockout or a no-policy
 * submission): who and what the submission is, from Federato's own Submission
 * record, and in plain words why it was not fully scored. Every value is the
 * DTO's; an absent one says so in words.
 */
export declare function AccountFacts(props: AccountFactsProps): ReactElement;
//# sourceMappingURL=AccountFacts.d.ts.map