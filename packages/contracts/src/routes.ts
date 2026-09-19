/**
 * The route table from PRD §8, as typed constants. FROZEN after Run 0 (W0-3).
 *
 * `apps/api/src/app.ts` registers exactly these, in this order, and the console
 * and the phone app build every URL from `routePath(...)` — nobody hand-writes
 * a path string twice.
 */

export type HttpMethod = 'GET' | 'POST';

export const ROUTE_IDS = [
  'health',
  'ingestFederato',
  'listSubmissions',
  'getSubmission',
  'runSubmission',
  'enrichSubmission',
  'replyToSubmission',
  'planActions',
  'listActions',
  'approveAction',
  'createSweep',
  'getSweep',
  'answerSweep',
  'nextQuestion',
  'verifyFix',
  'aggregate',
  'rules',
  'glossary',
  'share',
] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

export interface RouteDef {
  readonly id: RouteId;
  readonly method: HttpMethod;
  /** Hono pattern, e.g. `/submissions/:id`. */
  readonly path: string;
  /** Ordered names of the `:params` in `path`. */
  readonly params: readonly string[];
  readonly summary: string;
  /** True for the two routes a browser may hit without the console. */
  readonly public: boolean;
  /** Run 1 unit that fills the handler. */
  readonly unit: string;
}

export const ROUTES: Readonly<Record<RouteId, RouteDef>> = {
  health: {
    id: 'health',
    method: 'GET',
    path: '/health',
    params: [],
    summary: 'Liveness plus the active adapter.',
    public: true,
    unit: 'A11',
  },
  ingestFederato: {
    id: 'ingestFederato',
    method: 'POST',
    path: '/ingest/federato',
    params: [],
    summary: 'Run the planner, normalize, evaluate, store. Idempotent by externalId.',
    public: false,
    unit: 'A12',
  },
  listSubmissions: {
    id: 'listSubmissions',
    method: 'GET',
    path: '/submissions',
    params: [],
    summary: 'The ranked queue.',
    public: false,
    unit: 'A12',
  },
  getSubmission: {
    id: 'getSubmission',
    method: 'GET',
    path: '/submissions/:id',
    params: ['id'],
    summary: 'Full EngineResult, query trace, explanation.',
    public: false,
    unit: 'A12',
  },
  runSubmission: {
    id: 'runSubmission',
    method: 'POST',
    path: '/submissions/:id/run',
    params: ['id'],
    summary: 'Re-run enrichment and the engine.',
    public: false,
    unit: 'A13',
  },
  enrichSubmission: {
    id: 'enrichSubmission',
    method: 'POST',
    path: '/enrich/:id',
    params: ['id'],
    summary: 'Run the enrichment plugins, then re-run the engine.',
    public: false,
    unit: 'A13',
  },
  replyToSubmission: {
    id: 'replyToSubmission',
    method: 'POST',
    path: '/submissions/:id/reply',
    params: ['id'],
    summary: 'Free text or a PDF: extract, validate, apply, re-score.',
    public: false,
    unit: 'A14',
  },
  planActions: {
    id: 'planActions',
    method: 'POST',
    path: '/actions/plan',
    params: [],
    summary: 'Routing plus request drafts for every qualifying account.',
    public: false,
    unit: 'A14',
  },
  listActions: {
    id: 'listActions',
    method: 'GET',
    path: '/actions',
    params: [],
    summary: 'The outbox and the action log.',
    public: false,
    unit: 'A14',
  },
  approveAction: {
    id: 'approveAction',
    method: 'POST',
    path: '/actions/:id/approve',
    params: ['id'],
    summary: 'Approve a draft. Marks it sent; nothing is actually emailed.',
    public: false,
    unit: 'A14',
  },
  createSweep: {
    id: 'createSweep',
    method: 'POST',
    path: '/sweeps',
    params: [],
    summary: 'Start the sweep pipeline.',
    public: false,
    unit: 'A15',
  },
  getSweep: {
    id: 'getSweep',
    method: 'GET',
    path: '/sweeps/:id',
    params: ['id'],
    summary: 'Poll `stage`.',
    public: false,
    unit: 'A15',
  },
  answerSweep: {
    id: 'answerSweep',
    method: 'POST',
    path: '/sweeps/:id/answers',
    params: ['id'],
    summary: 'Submit VOI answers and observation confirmations.',
    public: false,
    unit: 'A15',
  },
  nextQuestion: {
    id: 'nextQuestion',
    method: 'GET',
    path: '/sweeps/:id/next-question',
    params: ['id'],
    summary: 'The next question, with the skipped list and its reasons.',
    public: false,
    unit: 'A15',
  },
  verifyFix: {
    id: 'verifyFix',
    method: 'POST',
    path: '/sweeps/:id/verify-fix',
    params: ['id'],
    summary: 'One new photo of a fixed hazard: re-run, return new verdict and price.',
    public: false,
    unit: 'A15',
  },
  aggregate: {
    id: 'aggregate',
    method: 'GET',
    path: '/aggregate',
    params: [],
    summary: 'Portfolio numbers and the verification headline.',
    public: false,
    unit: 'A13',
  },
  rules: {
    id: 'rules',
    method: 'GET',
    path: '/rules',
    params: [],
    summary: 'Active rulebooks with citations and interpretations.',
    public: false,
    unit: 'A11',
  },
  glossary: {
    id: 'glossary',
    method: 'GET',
    path: '/glossary',
    params: [],
    summary: 'The glossary; also powers the console tooltips.',
    public: false,
    unit: 'A11',
  },
  share: {
    id: 'share',
    method: 'GET',
    path: '/s/:shareSlug',
    params: ['shareSlug'],
    summary: 'Public result JSON. No contact details, no secrets.',
    public: true,
    unit: 'A11',
  },
};

/** Registration order. `app.ts` walks this array and nothing else. */
export const ROUTE_LIST: readonly RouteDef[] = ROUTE_IDS.map((id) => ROUTES[id]);

/**
 * Fills a route's `:params`. Values are URI-encoded.
 * `routePath('getSubmission', { id: 'a b' })` -> `/submissions/a%20b`.
 */
export function routePath(
  id: RouteId,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const def = ROUTES[id];
  let path = def.path;
  for (const name of def.params) {
    const raw = params[name];
    if (raw === undefined) {
      throw new Error(`routePath: missing param "${name}" for route "${id}"`);
    }
    path = path.replace(`:${name}`, encodeURIComponent(String(raw)));
  }
  return path;
}

/** Appends a query string, skipping undefined and empty values. */
export function withQuery(
  path: string,
  query: Readonly<Record<string, string | number | boolean | undefined>> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs.length > 0 ? `${path}?${qs}` : path;
}

/** Default page size for every list route. */
export const DEFAULT_PAGE_LIMIT = 200;
export const MAX_PAGE_LIMIT = 500;

/** The status code every Run 0 skeleton route answers with until Run 1 fills it. */
export const NOT_IMPLEMENTED_STATUS = 501;
