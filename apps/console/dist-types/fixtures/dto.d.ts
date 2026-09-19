import type { QueueRowView, SubmissionDetailView } from '../panels/types.js';
/**
 * Typed console fixtures: one FIT, one REFER, one DOES_NOT_FIT and one account
 * with no policy record. Used by the C0x component tests so the console can be
 * tested without the API. Stub frozen by W0-4; unit C01 replaces these bodies.
 */
export declare function fixtureQueue(): readonly QueueRowView[];
export declare function fixtureSubmission(kind: 'fit' | 'refer' | 'dnf' | 'no-policy'): SubmissionDetailView;
//# sourceMappingURL=dto.d.ts.map