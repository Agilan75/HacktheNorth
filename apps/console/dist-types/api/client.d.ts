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
        readonly count: number;
    }[];
    readonly oneFlipAway: readonly QueueRowView[];
    readonly bookAdequacy: number | null;
    readonly verification: Readonly<Record<string, number | string | null>>;
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
}
/** Stub frozen by W0-4. Unit C01 replaces this body only. */
export declare function createApiClient(_options: ApiClientOptions): ApiClient;
//# sourceMappingURL=client.d.ts.map