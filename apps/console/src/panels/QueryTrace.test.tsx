import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { QueryTrace } from './QueryTrace';
import type { QueryTraceEntryView } from './types';

const triage: QueryTraceEntryView = {
  step: 1,
  phase: 'triage',
  resource: 'Submission',
  purpose: 'Select id, status and line of business for every submission',
  payload: { select: ['id', 'status', 'line_of_business'] },
  resultCount: 158,
  durationMs: 412,
  adapted: false,
  note: null,
};

const deep: QueryTraceEntryView = {
  step: 2,
  phase: 'deep',
  resource: 'Policy',
  purpose: 'Hydrate insured, claims and buildings for the 38 property survivors',
  payload: { expand: { insured: true, claims: true } },
  resultCount: 27,
  durationMs: 1830,
  adapted: true,
  note: 'Zero rows on a dot-path; retried with $elemMatch',
};

afterEach(cleanup);

describe('QueryTrace', () => {
  it('renders entries ordered by step regardless of input order', () => {
    render(<QueryTrace entries={[deep, triage]} />);
    const items = screen.getAllByTestId('query-trace-entry');
    expect(items.map((li) => li.getAttribute('data-step'))).toEqual(['1', '2']);
    expect(within(items[0]!).getByText('Submission')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Policy')).toBeInTheDocument();
  });

  it('shows row counts, durations, the adapted badge and the note', () => {
    render(<QueryTrace entries={[triage, deep]} />);
    const [first, second] = screen.getAllByTestId('query-trace-entry');
    expect(first).toHaveTextContent('Returned 158 rows in 412 ms.');
    expect(second).toHaveTextContent('Returned 27 rows in 1.83 s.');
    expect(within(first!).queryByText('Adapted')).toBeNull();
    expect(within(second!).getByText('Adapted')).toBeInTheDocument();
    expect(within(second!).getByText('Zero rows on a dot-path; retried with $elemMatch')).toBeInTheDocument();
    expect(screen.getByText('2 queries · 1 adapted')).toBeInTheDocument();
  });

  it('prints the payload as pretty JSON', () => {
    render(<QueryTrace entries={[triage]} />);
    const code = screen.getByText(/"select"/);
    expect(code.textContent).toBe(JSON.stringify(triage.payload, null, 2));
  });

  it('does not throw on a cyclic payload', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    render(<QueryTrace entries={[{ ...triage, payload: cyclic }]} />);
    expect(screen.getByText('[object Object]')).toBeInTheDocument();
  });

  it('renders an empty state', () => {
    render(<QueryTrace entries={[]} />);
    expect(screen.getByRole('heading', { name: 'How the agent got here' })).toBeInTheDocument();
    expect(screen.getByText('No queries were recorded for this submission.')).toBeInTheDocument();
  });

  describe('R3-2: the reasoning reads as prose (PRD 7.5 step 6)', () => {
    const reasoned: QueryTraceEntryView = {
      ...deep,
      step: 3,
      phase: 'adapt_retry',
      purpose: 'Fetch building TIV and construction for the property survivors',
      adapted: true,
      note: null,
      path: ['exposure_units', 'location'],
      why: 'Policy carries premium, TIV and the buildings in one query.',
      alternativesRejected: [
        { rootResource: 'Submission', path: [], why: 'Submission has no TIV field.' },
        { rootResource: 'Location', path: [], why: 'Location has no premium.' },
      ],
      requiredBy: [
        { ruleId: 'commercial.tiv', factor: 'tiv', canonicalPath: 'buildings.*.tiv', why: 'the TIV band rule scores total insured value' },
        { ruleId: 'commercial.construction', factor: null, canonicalPath: 'buildings.*.constructionType', why: 'construction class' },
      ],
      adaptation: 'elem_match_swap',
      error: null,
    };

    it('shows the goal, the rules that needed it, the path and why, and the rejected alternatives', () => {
      render(<QueryTrace entries={[reasoned]} />);
      const entry = screen.getByTestId('query-trace-entry');
      expect(within(entry).getByTestId('trace-goal')).toHaveTextContent(
        'Goal: Fetch building TIV and construction for the property survivors',
      );
      const needs = within(entry).getAllByTestId('trace-need');
      expect(needs).toHaveLength(2);
      expect(needs[0]).toHaveTextContent(
        'Rule commercial.tiv (tiv) needs buildings.*.tiv: the TIV band rule scores total insured value',
      );
      expect(needs[1]).toHaveTextContent('Rule commercial.construction needs buildings.*.constructionType: construction class');
      expect(within(entry).getByTestId('trace-path')).toHaveTextContent(
        'Went to Policy → exposure_units → location because Policy carries premium, TIV and the buildings in one query.',
      );
      const rejected = within(entry).getAllByTestId('trace-rejected');
      expect(rejected.map((r) => r.textContent)).toEqual([
        'Submission: Submission has no TIV field.',
        'Location: Location has no premium.',
      ]);
      expect(entry).toHaveTextContent('Returned 27 rows in 1.83 s.');
    });

    it('explains an adaptation in words, with a text label and not colour alone', () => {
      render(<QueryTrace entries={[reasoned]} />);
      const adaptation = screen.getByTestId('trace-adaptation');
      expect(adaptation).toHaveTextContent('Adapted:');
      expect(adaptation).toHaveTextContent('$elemMatch');
      expect(adaptation).not.toHaveTextContent('elem_match_swap');
    });

    it('names an unknown adaptation kind verbatim', () => {
      render(<QueryTrace entries={[{ ...reasoned, adaptation: 'widen_window' }]} />);
      expect(screen.getByTestId('trace-adaptation')).toHaveTextContent('Adapted: widen_window');
    });

    it('shows nothing for an adaptation of "none", null or absent', () => {
      render(
        <QueryTrace
          entries={[
            { ...reasoned, step: 1, adaptation: 'none', adapted: false },
            { ...reasoned, step: 2, adaptation: null, adapted: false },
            { ...triage, step: 4 },
          ]}
        />,
      );
      expect(screen.queryByTestId('trace-adaptation')).toBeNull();
      expect(screen.queryByText(/none/)).toBeNull();
    });

    it('says plainly when no scoring rule needed the query and when nothing was rejected', () => {
      render(<QueryTrace entries={[{ ...reasoned, requiredBy: [], alternativesRejected: [] }]} />);
      expect(screen.getByTestId('trace-needs-none')).toHaveTextContent('No scoring rule needed this query');
      expect(screen.queryByTestId('trace-rejected')).toBeNull();
    });

    it('renders an error with a text label', () => {
      render(<QueryTrace entries={[{ ...reasoned, error: 'Deep pass failed [500]: boom' }]} />);
      expect(screen.getByTestId('trace-error')).toHaveTextContent('Error: Deep pass failed [500]: boom');
    });

    it('does not print a JSON dump outside the collapsed payload', () => {
      render(<QueryTrace entries={[reasoned]} />);
      const entry = screen.getByTestId('query-trace-entry');
      const details = entry.querySelector('details');
      expect(details).not.toBeNull();
      expect(details!.open).toBe(false);
      const outside = [...entry.children].filter((c) => c !== details).map((c) => c.textContent).join(' ');
      expect(outside).not.toMatch(/[{}]/);
    });
  });
});
