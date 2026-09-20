import type { ReactElement } from 'react';
import type { AccountVerificationView } from './types.js';
/**
 * Agree / disagree as a symbol AND a word (PRD 13: colour never carries
 * meaning alone; here there is no colour at all).
 */
export declare function AgreeMark(props: {
    readonly agrees: boolean;
}): ReactElement;
export interface IndependentChecksProps {
    readonly verification: AccountVerificationView;
    /** Path of the Verification page (App's route table). */
    readonly verificationPath: string;
}
/**
 * The two independent checks run on this real property account (PRD 12):
 * layer B's naive second implementation, written from the guideline table
 * with no shared code, and layer C's second-opinion model, given only the
 * guideline text and the facts. Every value is the DTO's.
 */
export declare function IndependentChecks(props: IndependentChecksProps): ReactElement;
//# sourceMappingURL=IndependentChecks.d.ts.map