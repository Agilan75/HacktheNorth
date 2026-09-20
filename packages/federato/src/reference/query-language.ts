/**
 * Notes transcribed from QUERY_REQUEST_BODY.pdf, so the mock and the planner
 * can be checked against the document. Body owned by Run 1 unit F06.
 *
 * `quote` is verbatim prose from the PDF (7 pages), with its line wraps joined.
 * Code samples are not quoted; the prose that states the rule is. `implementation`
 * says where Retrofit honours the rule, or why it deviates — the one deviation is
 * `over`, which the live handler does not implement (LIVE_DATA_FACTS.md).
 */
import type { QueryStage } from '../types';

export interface QueryLanguageNote {
  readonly id: string;
  readonly stage: QueryStage | 'operators' | 'combinators' | 'references';
  readonly title: string;
  readonly quote: string;
  readonly page: number;
  /** How Retrofit implements it, or why it deviates (e.g. `over` is never emitted). */
  readonly implementation: string;
}

const NOTES: readonly QueryLanguageNote[] = Object.freeze(
  (
    [
      {
        id: 'overview-keys',
        stage: 'where',
        title: 'Overview',
        quote:
          'Every key is optional except resource . resource, where, expand, unwind, filter, over, select, sort, pagination',
        page: 1,
        implementation:
          '`QueryPayload` makes `resource` the only required key; every other clause is optional and typed in types.ts.',
      },
      {
        id: 'pipeline-order',
        stage: 'where',
        title: 'Query Pipeline',
        quote:
          'where (filter raw records) ↓ expand (hydrate references) ↓ unwind (fan arrays into rows) ↓ filter (filter hydrated rows) ↓ over (partition into groups) ↓ select (paths + expand + reductions) ↓ sort (order results) ↓ paginate (limit/offset) Omitted steps are no-ops.',
        page: 1,
        implementation:
          '`QUERY_STAGES` fixes this order; the mock `runPipeline` (mock/pipeline.ts) applies the stages in it and treats an omitted clause as a no-op.',
      },
      {
        id: 'where-shape',
        stage: 'where',
        title: 'Filtering',
        quote:
          'A where value mirrors the shape of your records. Keys are either field names or operators (starting with $).',
        page: 1,
        implementation:
          'mock/where.ts `applyWhere` matches a clause against raw records; a non-`$` key is a field path, a `$` key an operator or combinator.',
      },
      {
        id: 'where-array-equality',
        stage: 'where',
        title: 'Filtering (array literal)',
        quote: "// where Location.hazard_tags === ['hail', 'wildfire']",
        page: 1,
        implementation:
          'An array literal in a clause is whole-array deep equality (`deepEqual`), not membership; the planner uses `$in` or `$elemMatch` for membership.',
      },
      {
        id: 'operators-table',
        stage: 'operators',
        title: 'Operators',
        quote:
          '$eq Deep equality Any type; $ne Not equal Any type; $exists Field exists Any type; $gt , $gte , $lt , $lte Comparisons Scalars; $in In list Scalars/arrays; $nin Not in list Scalars/arrays; $contains Contains substring/element Scalars/arrays; $elemMatch At least one array element matches Arrays only',
        page: 2,
        implementation:
          'All eleven operators are implemented in mock/where.ts `matchOperators`; the planner emits plain equality and `$in`, and `$elemMatch` on adapt.',
      },
      {
        id: 'nested-objects',
        stage: 'where',
        title: 'Nested Objects',
        quote: 'For nested objects, nesting and dot-paths are equivalent:',
        page: 2,
        implementation:
          '`readDotPath` resolves `dates.effective` and `{ dates: { effective } }` to the same value.',
      },
      {
        id: 'array-boundaries',
        stage: 'filter',
        title: 'Array Clauses',
        quote:
          'Be careful with arrays: Use $elemMatch to break paths at array boundaries. $elemMatch passes if at least one element satisfies the sub-clause:',
        page: 2,
        implementation:
          'Dot-paths never cross an array (measured live: `exposure_units.location.state` = "CA" returns 0, `$elemMatch` returns 47). The planner adapt step (planner/adapt.ts `swapToElemMatch`) retries a zero-row dot-path with `$elemMatch`.',
      },
      {
        id: 'combinators',
        stage: 'combinators',
        title: 'Combinators',
        quote:
          '$and , $or , $not work as expected. Multiple operators in one clause implicitly form $and .',
        page: 2,
        implementation:
          '`matchClause` evaluates `$and`/`$or`/`$not` and ANDs every sibling key of a clause.',
      },
      {
        id: 'references',
        stage: 'references',
        title: 'References',
        quote:
          'Some fields are references: they store IDs pointing to records in another resource. Use expand when something downstream needs the reference. Use $expand when you only want it in the reply.',
        page: 3,
        implementation:
          'The planner reads references from the live schema (`type: "reference"`) into its resource graph and uses the `expand` stage for the deep pass, because the engine needs hydrated buildings and claims.',
      },
      {
        id: 'expand-stage',
        stage: 'expand',
        title: 'The expand Stage',
        quote:
          '// A STAGE. Hydrates the record, so filter/over/sort/select can reach through producer.broker. Chain by nesting:',
        page: 3,
        implementation:
          'The deep pass emits `expand { insured, submission, claims, exposure_units: { location: { buildings } } }` — verified live to hydrate all 27 property policies in one call. `true`, `{}` and a string leaf are equivalent in the mock `applyExpand`.',
      },
      {
        id: 'expand-leaf',
        stage: 'select',
        title: 'The $expand Leaf',
        quote: '// A SELECT LEAF. Resolves in the output only.',
        page: 3,
        implementation:
          'Implemented in the mock `applySelect`. The triage query emits it for `insured`, `broker` and `underwriter` (`{ $expand: { select: ["name"] } }`): their names are display facts wanted in the reply only, so no expand stage runs. Every reference the deep pass follows is needed downstream and uses the expand stage.',
      },
      {
        id: 'projection',
        stage: 'select',
        title: 'Projection',
        quote:
          'Omit select to return the entire record shape. Two forms: A select leaf is one of three things:',
        page: 4,
        implementation:
          'The triage pass uses the array form (`["id", "submission_number", "status", "line_of_business"]`); the deep pass omits `select` to receive whole hydrated records.',
      },
      {
        id: 'aggregations',
        stage: 'select',
        title: 'Aggregations',
        quote:
          '$sum path Non-numeric/null skipped. Sum of nothing = 0; $avg path Nulls skipped. Average of nothing = null; $min / $max path Nulls skipped. Result over nothing = null; $count true Counts every row, nulls included; $countDistinct path or array Distinct over non-null only',
        page: 4,
        implementation:
          'The mock implements the six reductions with these edge rules. The planner never asks the server to aggregate: every rollup is computed in packages/engine stage 3.',
      },
      {
        id: 'unwind',
        stage: 'unwind',
        title: 'Unwinding',
        quote:
          'Each entry is a path string or { path, type } . // k records; k <= N // N records',
        page: 5,
        implementation:
          'Mock `applyUnwind`: `inner` drops parents whose array is empty, `left` keeps them. The planner does not unwind; the engine walks the hydrated arrays itself.',
      },
      {
        id: 'fan-out',
        stage: 'unwind',
        title: 'Fan-Out',
        quote:
          'Return a stream of associated objects with parent information: To recover all exposure units per policy, include an over clause:',
        page: 5,
        implementation:
          'Not used: recovering per-policy groups needs `over`, which the live handler does not honour.',
      },
      {
        id: 'grouping',
        stage: 'over',
        title: 'Grouping',
        quote:
          'Much like SQL GROUP BY, over partitions rows. Defaults to [‘id’]. Groups come back as flat projections in first-seen order:',
        page: 5,
        implementation:
          'DEVIATION: `over` is never emitted. Measured live, the handler returns `results` (never `groups`), one row per input record, `$count` = 1 on every row and a constant `$sum` artifact. The mock implements the documented behaviour for parity only; F10 records a trace note when it declines server-side aggregation.',
      },
      {
        id: 'ordering',
        stage: 'sort',
        title: 'Ordering',
        quote:
          'Rules apply in priority order. direction defaults to “asc”. Nulls sort last. Sort runs after select, so it can reference derived paths:',
        page: 5,
        implementation:
          'Mock `applySort` sorts by each rule in priority order, `asc` by default, nulls last, after `select`. The planner sorts every query by `id` ascending, so traces are deterministic.',
      },
      {
        id: 'pagination',
        stage: 'pagination',
        title: 'Pagination',
        quote: 'The total in results reports total matching records, irrespective of pagination.',
        page: 6,
        implementation:
          '`QueryResult.total` is the pre-pagination count; the planner defaults to `limit: 200`, above the 158 submissions and 113 policies it roots queries at.',
      },
    ] satisfies QueryLanguageNote[]
  ).map((n) => Object.freeze(n)),
);

export function queryLanguageNotes(): readonly QueryLanguageNote[] {
  return NOTES;
}
