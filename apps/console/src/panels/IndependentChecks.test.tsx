import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { IndependentChecks } from './IndependentChecks.js';
import type { AccountVerificationView } from './types.js';

afterEach(cleanup);

/** SUB-2024-00065 from packages/verify/out/per-account.json, as the API serves it. */
const ENGINE = {
  verdict: 'DOES_NOT_FIT' as const,
  appetiteScore: 52.99999999999999,
  knockoutFactorIds: ['building_age', 'construction_type', 'primary_risk_state'],
  decidingFactorId: 'primary_risk_state',
};
const REASONING =
  "The primary risk state is TX, which falls under 'All other states' in the Not Acceptable column of the guideline table.";

const REAL: AccountVerificationView = {
  caseId: 'SUB-2024-00065',
  generatedAt: '2026-09-19T19:30:25.951Z',
  engine: ENGINE,
  matchesCurrentResult: true,
  naive: { ...ENGINE, agrees: { verdict: true, appetiteScore: true, knockouts: true, decidingFactor: true, all: true } },
  secondOpinion: {
    verdict: 'DOES_NOT_FIT',
    decidingFactor: 'primary_risk_state',
    reasoning: REASONING,
    agreed: true,
    decidingFactorAgreed: true,
    engine: ENGINE,
  },
};

function mount(v: AccountVerificationView): void {
  render(
    <MemoryRouter>
      <IndependentChecks verification={v} verificationPath="/verification" />
    </MemoryRouter>,
  );
}

describe('IndependentChecks', () => {
  it('shows both checks agreeing, with the DTO values formatted only', () => {
    mount(REAL);
    expect(screen.getByTestId('checks-summary')).toHaveTextContent('Both independent checks reached the same verdict as the engine.');
    const score = within(screen.getByTestId('naive-appetiteScore')).getAllByRole('cell');
    expect(score.map((c) => c.textContent)).toEqual(['53/100', '53/100', '✓ Agrees']);
    expect(screen.getByTestId('naive-knockouts')).toHaveTextContent('Building age, Construction type, Primary risk state');
    expect(screen.getByTestId('naive-decidingFactor')).toHaveTextContent('Primary risk state');
    expect(screen.getByTestId('second-opinion-reasoning')).toHaveTextContent(REASONING);
    expect(screen.getByTestId('second-opinion')).toHaveTextContent('Primary risk state');
    expect(screen.queryByTestId('checks-stale')).toBeNull();
    expect(screen.getByRole('link', { name: /How the testing works/ })).toHaveAttribute('href', '/verification');
  });

  it('marks a disagreement with a word and a symbol, never colour alone', () => {
    mount({
      ...REAL,
      naive: { ...REAL.naive, decidingFactorId: 'building_age', agrees: { ...REAL.naive.agrees, decidingFactor: false, all: false } },
      secondOpinion: { ...REAL.secondOpinion!, verdict: 'REFER', agreed: false, decidingFactorAgreed: false },
    });
    expect(screen.getByTestId('checks-summary')).toHaveTextContent('Neither independent check agrees with the engine.');
    const mark = within(screen.getByTestId('naive-decidingFactor')).getByText('Disagrees');
    expect(mark.closest('[data-agrees]')).toHaveAttribute('data-agrees', 'false');
    expect(mark.closest('[data-agrees]')!.textContent).toBe('✗ Disagrees');
    expect(within(screen.getByTestId('second-opinion')).getAllByText('Disagrees')).toHaveLength(2);
  });

  it('says in words when the second opinion never answered, and when the page result has moved on', () => {
    mount({ ...REAL, secondOpinion: null, matchesCurrentResult: false });
    expect(screen.getByTestId('second-opinion-missing')).toHaveTextContent('never answered');
    expect(screen.getByTestId('checks-summary')).toHaveTextContent('The second-opinion model never answered.');
    expect(screen.getByTestId('checks-stale')).toHaveTextContent('re-scored since these checks ran');
  });
});
