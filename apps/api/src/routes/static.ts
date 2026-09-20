/** GET /health, /rules, /glossary and /s/:shareSlug. Body owned by Run 1 unit A11. */
import type { Hono } from 'hono';
import type {
  ErrorDto,
  GlossaryResponseDto,
  HealthDto,
  RulesResponseDto,
  ShareDto,
} from '@retrofit/contracts';
import { ROUTES } from '@retrofit/contracts';
import type { AppliedInterpretation, Rulebook } from '@retrofit/engine';
import { readRulebook } from '@retrofit/engine';
import type { ApiEnv } from '../app';
import { createRepos } from '../db/repos';
import type { SubmissionRow } from '../db/schema';
import type { Deps } from '../services/types';

/* -------------------------------------------------------------------------- */
/* Rulebooks                                                                  */
/* -------------------------------------------------------------------------- */

type RulebookName = 'commercial' | 'extensions' | 'tenant';

/** Served in this order: Federato's document first, ours labelled and separate. */
const RULEBOOKS: readonly { readonly name: RulebookName; readonly label: string }[] = [
  { name: 'commercial', label: 'Federato appetite guidelines — commercial property' },
  { name: 'extensions', label: 'Retrofit extensions (ours, not Federato’s)' },
  { name: 'tenant', label: 'Tenant rulebook (Retrofit)' },
];

/**
 * The appetite score is `100 * (w · t)` over Federato's eight factors, so the
 * weights the console shows are the commercial rulebook's (docs/decisions/A11.md).
 */
const SCORE_WEIGHTS_FROM: RulebookName = 'commercial';

function buildRulesResponse(books: readonly Rulebook[]): RulesResponseDto {
  const interpretations: AppliedInterpretation[] = [];
  const seen = new Set<string>();
  for (const book of books) {
    for (const interp of book.interpretations ?? []) {
      if (seen.has(interp.id)) continue;
      seen.add(interp.id);
      interpretations.push(interp);
    }
  }
  const weightsBook = books.find((b) => b.id === SCORE_WEIGHTS_FROM);
  return {
    rulebooks: RULEBOOKS.map(({ name, label }, i) => {
      const book = books[i] as Rulebook;
      return {
        id: book.id,
        label,
        version: book.version,
        isExtension: name === 'extensions',
        rules: book.rules,
      };
    }),
    interpretations,
    weights: { ...(weightsBook?.weights ?? {}) },
  };
}

/* -------------------------------------------------------------------------- */
/* Share                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whitelists the public fields. Nothing else from the row or the result — no
 * canonical submission, no raw bundle, no broker contact — ever leaves.
 */
function toShareDto(slug: string, row: SubmissionRow): ShareDto | null {
  const result = row.result;
  if (result === null || result === undefined) return null;
  const deciding = result.verdict.decidingRule;
  return {
    slug,
    // The row's line, not the engine's: a triage knockout's engine result
    // carries Federato's raw line (`cyber`, R2-fixer-1 F1-1), which is not a
    // LineOfBusiness. The row is always `commercial_property` | `tenant`, and
    // it is what GET /submissions/:id reports too.
    lineOfBusiness: row.lineOfBusiness,
    verdict: result.verdict.verdict,
    appetiteScore: result.evaluate.appetiteScore,
    explanation: result.explanation,
    price: result.price,
    flip: result.flip,
    decidingRule:
      deciding === null
        ? null
        : { ruleId: deciding.ruleId, factor: deciding.factor, citation: deciding.citation },
    createdAt: row.createdAt,
  };
}

const errorBody = (code: string, message: string): ErrorDto => ({ error: { code, message } });

/* -------------------------------------------------------------------------- */
/* Registrar                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Registers this module's handlers on the frozen app. Throwing here in Run 0 is
 * expected: `app.ts` catches it and serves the 501 fallbacks instead.
 */
export function registerStaticRoutes(app: Hono<ApiEnv>, deps: Deps): void {
  const repos = createRepos(deps.db);

  /** Rulebooks are packaged data and never change while the process runs. */
  let rulebooks: Promise<readonly Rulebook[]> | null = null;
  const loadRulebooks = (): Promise<readonly Rulebook[]> => {
    if (rulebooks === null) {
      rulebooks = Promise.all(RULEBOOKS.map(({ name }) => readRulebook(name)));
      // A failed read is not cached: the next request retries it.
      rulebooks.catch(() => {
        rulebooks = null;
      });
    }
    return rulebooks;
  };

  app.get(ROUTES.health.path, (c) => {
    const body: HealthDto = {
      ok: true,
      version: c.get('version'),
      adapter: deps.adapter.kind,
      llmConfigured: deps.llm.configured,
      submissionCount: repos.submissions.list({ limit: 0 }).total,
      startedAt: c.get('startedAt'),
    };
    return c.json(body, 200);
  });

  app.get(ROUTES.rules.path, async (c) => {
    const body = buildRulesResponse(await loadRulebooks());
    return c.json(body, 200);
  });

  app.get(ROUTES.glossary.path, async (c) => {
    const doc = await deps.adapter.getGlossary();
    const body: GlossaryResponseDto = {
      doc: doc.doc,
      entries: doc.entries.map((e) => ({
        term: e.term,
        definition: e.definition,
        page: e.page,
        aliases: [...e.aliases],
      })),
    };
    return c.json(body, 200);
  });

  app.get(ROUTES.share.path, (c) => {
    const slug = c.req.param('shareSlug');
    const row = slug === undefined || slug === '' ? null : repos.submissions.byShareSlug(slug);
    if (row === null) {
      return c.json(errorBody('NOT_FOUND', `no shared result for "${slug ?? ''}"`), 404);
    }
    const body = toShareDto(row.shareSlug ?? slug ?? '', row);
    if (body === null) {
      return c.json(errorBody('NOT_SCORED', `shared submission "${slug ?? ''}" has no result yet`), 409);
    }
    return c.json(body, 200);
  });
}
