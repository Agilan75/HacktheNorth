import type { ReactElement } from 'react';
import type { Verdict } from '../../panels/types.js';
export interface VerdictPillProps {
    readonly verdict: Verdict;
    /** Optional trailing text, e.g. the deciding factor. Never replaces the verdict word. */
    readonly detail?: string;
}
/**
 * PRD 13: FIT is a red filled pill, REFER red outlined, DOES_NOT_FIT ink filled. The verdict word is always rendered as text, because colour never carries meaning alone.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export declare function VerdictPill(props: VerdictPillProps): ReactElement;
//# sourceMappingURL=VerdictPill.d.ts.map