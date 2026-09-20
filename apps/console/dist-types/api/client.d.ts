import type { VerificationDto } from '@retrofit/contracts';
import type { ActionLogEntryView, QueueRowView, ReplyResultView, SubmissionDetailView } from '../panels/types.js';
/** Base URL for the API. Vite env, never a secret (PRD §5 constraints). */
export interface ApiClientOptions {
    readonly baseUrl: string;
    readonly fetchImpl?: typeof fetch;
}
export interface HealthResponse {
    readonly ok: boolean;
    readonly adapter: 'live' | 'snapshot';
    readonly version: string;
}
export interface AggregateResponse {
    readonly countsByVerdict: Readonly<Record<string, number>>;
    readonly scoreHistogram: readonly {
        readonly bucket: string;
        readonly count: number;
    }[];
    readonly topKnockoutFactors: readonly {
        readonly factorId: string;
        /** The guideline's own label, from `AggregateDto` (C14). */
        readonly label?: string;
        readonly count: number;
    }[];
    readonly oneFlipAway: readonly QueueRowView[];
    readonly bookAdequacy: number | null;
    readonly verification: Readonly<Record<string, number | string | null>>;
    /** `AggregateDto.counts` without `byVerdict` (that is `countsByVerdict`). C14. */
    readonly counts?: {
        readonly total: number;
        readonly scored: number;
        readonly knockedOut: number;
        readonly byLine: Readonly<Record<string, number>>;
    };
    /** `AggregateDto.bookAdequacy` in full: median, underpriced count and n. C14. */
    readonly bookAdequacyDetail?: {
        readonly median: number | null;
        readonly underpricedCount: number;
        readonly n: number;
    };
    /** The engine's single flip move per one-flip submission id, kept when a queue row replaces it. C14. */
    readonly oneFlipMoves?: Readonly<Record<string, {
        readonly moveLabel: string;
        readonly scoreAfter: number;
        readonly premiumAfter: number | null;
    }>>;
}
export interface RulesResponse {
    readonly rulebooks: readonly unknown[];
}
export interface GlossaryResponse {
    readonly entries: readonly {
        readonly term: string;
        readonly definition: string;
        readonly source: string;
    }[];
}
export interface ApiClient {
    health(): Promise<HealthResponse>;
    getQueue(): Promise<readonly QueueRowView[]>;
    getSubmission(id: string): Promise<SubmissionDetailView>;
    runSubmission(id: string): Promise<SubmissionDetailView>;
    enrich(id: string): Promise<SubmissionDetailView>;
    planActions(): Promise<readonly ActionLogEntryView[]>;
    getActions(): Promise<readonly ActionLogEntryView[]>;
    approveAction(actionId: string): Promise<ActionLogEntryView>;
    postReply(id: string, input: {
        readonly text?: string;
        readonly file?: File;
    }): Promise<ReplyResultView>;
    getAggregate(): Promise<AggregateResponse>;
    getRules(): Promise<RulesResponse>;
    getGlossary(): Promise<GlossaryResponse>;
    /** GET /verification, returned as the API sent it: the page formats, never recomputes. */
    getVerification(): Promise<VerificationDto>;
}
export declare function createApiClient(options: ApiClientOptions): ApiClient;
//# sourceMappingURL=client.d.ts.map