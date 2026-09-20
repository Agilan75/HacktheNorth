import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureQueue, fixtureSubmission } from '../fixtures/dto.js';
import type { QueueRowView, SubmissionDetailView } from '../panels/types.js';

/**
 * `#brief` reads the live queue and the rank-1 account, and its run strip posts
 * a real ingest. jsdom has neither, so `useApi` and `useApiClient` are mocked
 * and fed the typed console fixtures.
 *
 * What is worth pinning here is not the layout but the two promises the section
 * makes: every submission is listed with its own explanation, and the strip
 * never says LIVE unless a live run actually reported. Both are asserted.
 */
interface FakeState<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly reload: () => void;
}

const idle = { loading: false, error: null, reload: () => undefined };

let queueState: FakeState<readonly QueueRowView[]>;
let detailState: FakeState<SubmissionDetailView>;
let client: Record<string, unknown>;

vi.mock('../api/useApi.js', () => ({
  /**
   * Answers by probing which method the selector reaches for, the same trick
   * `TourPage.test.tsx` uses. Anything unrecognised gets an empty state rather
   * than another endpoint's payload.
   */
  useApi: (select: (c: Record<string, (arg?: unknown) => Promise<unknown>>) => Promise<unknown>) => {
    let asked = '';
    const probe = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          asked = prop;
          return () => Promise.resolve(null);
        },
      },
    ) as Record<string, (arg?: unknown) => Promise<unknown>>;
    void select(probe);
    if (asked === 'getQueue') return queueState;
    if (asked === 'getSubmission') return detailState;
    return { data: null, ...idle };
  },
  useApiClient: () => client,
}));

const { BriefGroup, RunStrip } = await import('./tour-brief.js');

const draw = () =>
  render(
    <MemoryRouter>
      <BriefGroup />
    </MemoryRouter>,
  );

/** The rank-1 fixture account, which every row follows. */
const TOP = fixtureSubmission('fit');

beforeEach(() => {
  queueState = { data: fixtureQueue(), ...idle };
  detailState = { data: TOP, ...idle };
  client = {
    startIngest: () => Promise.reject(new Error('not stubbed for this test')),
    getIngestRun: () => Promise.reject(new Error('not stubbed for this test')),
  };
});

afterEach(cleanup);

describe('the brief section', () => {
  it('is one region with the four requirements quoted from the brief, in order', () => {
    draw();
    const region = screen.getByRole('region', { name: 'The brief, answered' });
    // Scoped to the requirement quotes themselves: the reused console panels
    // quote guideline cells too, and those are not what this asserts.
    const quoted = [...region.querySelectorAll('.rf-brief__req-quote')].map((n) => n.textContent);
    expect(quoted).toEqual([
      '“Score each submission against carrier appetite guidelines”',
      '“Reason about which data to request from the API”',
      '“Rank submissions to surface the best opportunities”',
      '“Explain every decision in plain English”',
    ]);
  });

  it('lists every submission in the book, each with its own explanation', () => {
    const rows = fixtureQueue();
    draw();
    const list = screen.getByRole('region', { name: 'The ranked book' });
    // One body row per submission: the brief asks for an explanation on every
    // submission in the output, so nothing may be dropped or truncated away.
    const bodyRows = within(list).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(rows.length);
    for (const row of rows) {
      expect(within(list).getByText(row.explanationLine)).toBeInTheDocument();
    }
  });

  it('filters the book by verdict, and the chip counts match the book', () => {
    const rows = fixtureQueue();
    draw();
    const fitCount = rows.filter((r) => r.verdict === 'FIT').length;

    const fit = screen.getByRole('button', { name: `Fit (${fitCount})` });
    expect(screen.getByRole('button', { name: `All (${rows.length})` })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(fit);
    expect(fit).toHaveAttribute('aria-pressed', 'true');
    const list = screen.getByRole('region', { name: 'The ranked book' });
    expect(within(list).getAllByRole('row').slice(1)).toHaveLength(fitCount);
  });

  it('follows the rank-1 account through the rows, read off the queue and not hardcoded', () => {
    draw();
    const region = screen.getByRole('region', { name: 'The brief, answered' });
    expect(within(region).getAllByText(TOP.insuredName).length).toBeGreaterThan(0);
    // The brief's own block shape: id, score, verdict.
    expect(within(region).getByText(`SCORE ${String(Math.round(TOP.appetiteScore))}/100`)).toBeInTheDocument();
  });

  it('grades itself against the brief and keeps the rows it does not pass', () => {
    draw();
    const region = screen.getByRole('region', { name: 'The brief, answered' });
    // Every criterion now reads Yes, which is exactly why the limits list is
    // what this pins: a ledger of nothing but passes is a marketing document,
    // and a section that quietly dropped the caveats would be worse than none.
    // Said in the section lede and again above the table; both are deliberate.
    expect(within(region).getAllByText(/a ledger of nothing but passes/).length).toBeGreaterThan(0);
    expect(within(region).getByText(/Pagination is limit-only/)).toBeInTheDocument();
    expect(within(region).getByText(/no live example/)).toBeInTheDocument();
    expect(within(region).getByText(/flood load is a judgement, not a fit/)).toBeInTheDocument();
    expect(within(region).getByText(/never measured/)).toBeInTheDocument();
  });

  it('claims the enrichment bonus only alongside what enrichment still does not do', () => {
    draw();
    const region = screen.getByRole('region', { name: 'The brief, answered' });
    expect(within(region).getByText('Enrichment data visibly influences ranking')).toBeInTheDocument();
    // Two of the three external APIs still feed no decision, and the ledger
    // says so rather than letting the Yes above cover for them.
    expect(
      within(region).getByText(/Only one of the three external APIs reaches a decision/),
    ).toBeInTheDocument();
  });

  it('names where each supplied document went', () => {
    draw();
    const region = screen.getByRole('region', { name: 'The brief, answered' });
    const docs = [...region.querySelectorAll('.rf-tour__def dt code')].map((n) => n.textContent);
    expect(docs).toContain('APPETITE_GUIDELINES.pdf');
    expect(docs).toContain('STUDENT_PROJECT_GUIDELINES.pdf');
    expect(docs).toContain('GLOSSARY.pdf');
  });

  it('still renders the requirements and the ledger when the API is unreachable', () => {
    queueState = { data: null, loading: false, error: new Error('failed to fetch'), reload: () => undefined };
    detailState = { data: null, ...idle };
    draw();
    const region = screen.getByRole('region', { name: 'The brief, answered' });
    expect(within(region).getByRole('alert')).toHaveTextContent('failed to fetch');
    expect(within(region).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // The claims survive without evidence; they are never faked in its place.
    expect(within(region).getByText('Enrichment data visibly influences ranking')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'The ranked book' })).not.toBeInTheDocument();
  });
});

/**
 * The run strip on its own, with the poll cadence set to 0 so these assert what
 * the strip *says* without also asserting how fast a loaded CI worker runs.
 */
describe('the run strip', () => {
  const strip = () =>
    render(
      <MemoryRouter>
        <RunStrip replay={TOP.queryTrace} onFinished={() => undefined} pollMs={0} replayStepMs={0} />
      </MemoryRouter>,
    );

  it('offers the run and claims nothing before it has happened', () => {
    strip();
    expect(
      screen.getByRole('button', { name: 'Run the agent on the live queue' }),
    ).toBeEnabled();
    expect(screen.queryByText(/^LIVE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^REPLAY/)).not.toBeInTheDocument();
  });

  it('reports each query as it lands and says LIVE only once a live run reported', async () => {
    const steps = [
      { id: 'q-000', seq: 0, pass: 'triage', goal: 'Knock out every non-property line.', rootResource: 'Submission', rowCount: 158, totalAvailable: 158, durationMs: 1851, outcome: 'ok', adaptation: 'none', adaptedFrom: null, error: null },
      { id: 'q-001', seq: 1, pass: 'deep', goal: 'Hydrate every property policy.', rootResource: 'Policy', rowCount: 27, totalAvailable: 27, durationMs: 4100, outcome: 'ok', adaptation: 'none', adaptedFrom: null, error: null },
    ];
    let polls = 0;
    client = {
      startIngest: () => Promise.resolve({ runId: 'run-1', startedAt: '2026-09-19T12:00:00.000Z' }),
      getIngestRun: () => {
        polls += 1;
        return Promise.resolve(
          polls === 1
            ? { runId: 'run-1', startedAt: '2026-09-19T12:00:00.000Z', finishedAt: null, done: false, error: null, steps: [steps[0]], result: null }
            : {
                runId: 'run-1',
                startedAt: '2026-09-19T12:00:00.000Z',
                finishedAt: '2026-09-19T12:00:09.200Z',
                done: true,
                error: null,
                steps,
                result: { adapter: 'live', ingested: 158, updated: 0, skipped: 0, knockedOutAtTriage: 120, noPolicy: 11, queryCount: 4, durationMs: 9200, warnings: [], externalIds: [] },
              },
        );
      },
    };

    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Run the agent on the live queue' }));

    await vi.waitFor(
      () => {
        expect(screen.getByRole('status')).toHaveTextContent('LIVE');
      },
      { timeout: 5000 },
    );
    await vi.waitFor(
      () => {
        expect(screen.getByText(/158 submissions scored in 9\.2s/)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    // The real numbers off the trace, not a script.
    expect(screen.getByText('158 rows')).toBeInTheDocument();
    expect(screen.getByText('27 rows')).toBeInTheDocument();
    expect(screen.queryByText(/^REPLAY/)).not.toBeInTheDocument();
  });

  it('reports an older API that ran the book synchronously as the live run it was', async () => {
    /*
     * An API predating the `async` flag ignores it, runs the whole book and
     * answers 200 with the finished summary instead of 202 with a run id. That
     * is exactly what a stale local server does, and it used to end in
     * `getIngestRun(undefined)` and a routePath error dressed up as a replay.
     */
    client = {
      startIngest: () =>
        Promise.resolve({
          adapter: 'live',
          ingested: 0,
          updated: 158,
          skipped: 0,
          knockedOutAtTriage: 120,
          noPolicy: 11,
          queryCount: 4,
          durationMs: 8621,
          warnings: [],
          externalIds: [],
        }),
      getIngestRun: () => Promise.reject(new Error('must never be polled without a run id')),
    };

    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Run the agent on the live queue' }));

    await vi.waitFor(
      () => {
        expect(screen.getByText(/158 submissions scored in 8\.6s/)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    // It really did run, so it must not be called a replay.
    expect(screen.getByRole('status')).toHaveTextContent('LIVE');
    expect(screen.queryByText(/^REPLAY/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falls back to a replay, says so, and says why, when the run cannot start', async () => {
    client = {
      startIngest: () => Promise.reject(new Error('Federato token expired')),
      getIngestRun: () => Promise.reject(new Error('unused')),
    };

    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Run the agent on the live queue' }));

    await vi.waitFor(
      () => {
        expect(screen.getByRole('status')).toHaveTextContent('REPLAY');
      },
      { timeout: 5000 },
    );
    const why = screen.getByRole('alert');
    expect(why).toHaveTextContent('Federato token expired');
    expect(why).toHaveTextContent('Showing the stored trace instead');
    // The word LIVE must not be anywhere near a replay.
    expect(screen.queryByText(/^LIVE/)).not.toBeInTheDocument();
  });

  it('reports a run that fails midway as a replay, never as a finished live run', async () => {
    client = {
      startIngest: () => Promise.resolve({ runId: 'run-2', startedAt: '2026-09-19T12:00:00.000Z' }),
      getIngestRun: () =>
        Promise.resolve({
          runId: 'run-2',
          startedAt: '2026-09-19T12:00:00.000Z',
          finishedAt: '2026-09-19T12:00:03.000Z',
          done: true,
          error: 'the deep query was rejected',
          steps: [],
          result: null,
        }),
    };

    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Run the agent on the live queue' }));

    await vi.waitFor(
      () => {
        expect(screen.getByRole('alert')).toHaveTextContent('the deep query was rejected');
      },
      { timeout: 5000 },
    );
    expect(screen.getByRole('status')).toHaveTextContent('REPLAY');
  });
});
