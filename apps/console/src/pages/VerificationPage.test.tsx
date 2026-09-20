import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerificationDto } from '@retrofit/contracts';

import type { AsyncState } from '../api/useApi.js';

let apiState: AsyncState<VerificationDto>;

vi.mock('../api/useApi.js', () => ({
  useApi: () => apiState,
  useApiClient: () => {
    throw new Error('not used');
  },
}));


import { VerificationPage } from './VerificationPage.js';

const MODEL_REASONING =
  'The guideline specifies that Acceptable construction type requires ">50% JM, non-combustible/steel, or masonry non-combustible". The submission has exactly 50% of TIV in acceptable construction types, which fails to meet the >50% threshold and is therefore Not Acceptable.';

/** GET /verification on the committed files (abridged to three strata and two defects). */
const REAL: VerificationDto = {
  layersAB: {
    requested: 10000000, completed: 10000000, seed: 20260919, workers: 6, invariantViolations: 0, disagreements: 0, errors: 0,
    casesPerSecond: 3630.500562341317, startedAt: '2026-09-19T15:52:09.876Z', finishedAt: '2026-09-19T16:38:04.459Z',
  },
  layerC: {
    judged: 1332, agreed: 1331, unanswered: 706,
    agreement: { point: 0.9992492492492493, low: 0.9957596698938925, high: 0.9998674617628701, n: 1332, confidence: 0.95 },
    decidingFactorAgreed: 1319,
    byStratum: [
      { stratum: 'real_property', total: 38, agreed: 38, rate: 1 },
      { stratum: 'construction_exact_half', total: 80, agreed: 79, rate: 0.9875 },
      { stratum: 'empty_stratum', total: 0, agreed: 0, rate: null },
      { stratum: 'tiv_at_150m', total: 70, agreed: 70, rate: 1 },
    ],
    disagreements: [
      {
        caseId: 'V03:947746280:34', stratum: 'construction_exact_half',
        engine: {
          verdict: 'FIT', appetiteScore: 87.99999999999999, completeness: 100, knockoutFactorIds: [], decidingFactorId: 'tiv',
          tierValuesByFactor: { submission_type: 1, tiv: 0.6, construction_type: 1, loss_value: null },
        },
        model: { verdict: 'DOES_NOT_FIT', decidingFactor: 'construction_type', reasoning: MODEL_REASONING },
      },
    ],
  },
  realAccounts: { total: 38, naiveAgreedAll: 38, secondOpinionAnswered: 38, secondOpinionAgreed: 38, generatedAt: '2026-09-19T19:30:25.951Z' },
  extraction: {
    status: 'not_measured', fieldAccuracy: null,
    reason: 'It runs after layer C, and by then the Gemini credits were exhausted: every extraction call returned HTTP 402 and came back empty.',
  },
  defectsFound: {
    cp1InvariantViolations: 20662, cp1Disagreements: 1369, run2Confirmed: 39, run2Refuted: 11,
    defects: [
      { id: 'CP1-4', phase: 'CP1', title: 'Peer distance: scaled components clamp to [0, 1].', detail: '20,662 invariant violations, all `peerDistanceIsSymmetric`.' },
      { id: 'R2-3', phase: 'Run 2', title: 'Each hydrated building resolves to its own location.', detail: 'The primary risk state was wrong on 11 of the 27 real accounts.' },
    ],
  },
  sources: ['packages/verify/out/run.json', 'packages/verify/out/layer-c.json', 'VERIFICATION.md'],
};

function mount(state: Partial<AsyncState<VerificationDto>>): void {
  apiState = { data: null, loading: false, error: null, reload: vi.fn(), ...state } as AsyncState<VerificationDto>;
  render(
    <MemoryRouter>
      <VerificationPage />
    </MemoryRouter>,
  );
}

function tile(testId: string): string {
  return within(screen.getByTestId(testId)).getByRole('definition').textContent ?? '';
}

afterEach(cleanup);

describe('VerificationPage', () => {
  it('shows the headline straight from the DTO', () => {
    mount({ data: REAL });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Verification');
    expect(tile('v-cases')).toContain('10,000,000');
    expect(tile('v-cases')).toContain('of 10,000,000 requested · 6 workers · seed 20260919');
    expect(tile('v-violations')).toContain('0');
    expect(tile('v-disagreements')).toContain('0');
    expect(tile('v-errors')).toBe('0');
    expect(tile('v-agreement')).toContain('99.9%');
    expect(tile('v-agreement')).toContain('1,331 of 1,332 · 95% interval 99.6%–100.0%');
    expect(tile('v-extraction')).toBe('Not measured');
    expect(screen.getByTestId('extraction-reason')).toHaveTextContent('every extraction call returned HTTP 402');
    expect(document.body.textContent).toContain('3,631 cases per second');
  });

  it('shows the real-account checks', () => {
    mount({ data: REAL });
    expect(tile('real-total')).toBe('38');
    expect(tile('real-naive')).toContain('38 of 38');
    expect(tile('real-second')).toContain('38 of 38');
    expect(tile('real-second')).toContain('38 of 38 answered');
  });

  it('renders the per-stratum table, with a stratum that has no answers said in words', () => {
    mount({ data: REAL });
    const table = screen.getByRole('table', { name: 'Second-opinion agreement by stratum' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(table).toHaveTextContent('TIV at 150M');
    const half = within(table).getByText('Construction exact half').closest('tr') as HTMLElement;
    expect(within(half).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Construction exact half', '80', '79', '98.8%']);
    expect(within(table).getByText('Empty stratum').closest('tr')).toHaveTextContent('No answered cases');
    expect(screen.getByTestId('strata-note')).toHaveTextContent('706 unanswered');
    expect(screen.getByTestId('strata-note')).toHaveTextContent('1,319 of 1,331 agreeing cases also named the same deciding factor');
  });

  it('shows each disagreement with both sides side by side', () => {
    mount({ data: REAL });
    const d = screen.getByTestId('disagreement-V03:947746280:34');
    const engine = d.querySelector('[data-side=engine]') as HTMLElement;
    const model = d.querySelector('[data-side=model]') as HTMLElement;
    expect(engine).toHaveTextContent('88/100 · deciding factor: TIV');
    expect(within(engine).getByText('Construction type').closest('tr')).toHaveTextContent('1');
    expect(within(engine).getByText('Loss value').closest('tr')).toHaveTextContent('Unknown');
    expect(engine.querySelector('[data-verdict=FIT]')).not.toBeNull();
    expect(model.querySelector('[data-verdict=DOES_NOT_FIT]')).not.toBeNull();
    expect(model).toHaveTextContent('deciding factor: Construction type');
    expect(model).toHaveTextContent(MODEL_REASONING);
    expect(d).toHaveTextContent('The engine says Fit; the model says Does not fit.');
    expect(d).not.toHaveTextContent('less reliable party');
    expect(within(d).getByTestId('disagreement-link-V03:947746280:34')).toHaveAttribute(
      'href',
      `/submissions/${encodeURIComponent('V03:947746280:34')}`,
    );
    expect(d.tagName).toBe('DETAILS');
    expect(d).toHaveAttribute('open');
  });

  it('lists what the testing found, with the counts from the DTO', () => {
    mount({ data: REAL });
    const lead = screen.getByTestId('found-lead');
    expect(lead).toHaveTextContent('20,662 invariant violations and 1,369 disagreements');
    expect(lead).toHaveTextContent('confirmed 39 defects and refuted 11');
    expect(lead).not.toHaveTextContent('which is the point of it');
    expect(screen.getByTestId('defect-R2-3')).toHaveTextContent('Each hydrated building resolves to its own location.');
    expect(screen.getByTestId('defect-R2-3')).toHaveTextContent('(R2-3, Run 2)');
    expect(screen.getByTestId('sources')).toHaveTextContent('packages/verify/out/run.json');
  });

  it('a block the API returns as null says so in words', () => {
    mount({ data: { ...REAL, layersAB: null, layerC: null, realAccounts: null } });
    const missing = screen.getAllByTestId('block-missing').map((e) => e.textContent);
    expect(missing).toEqual([
      'No verification run found.',
      'No verification run found.',
      'No verification run found.',
    ]);
    expect(screen.queryByTestId('v-cases')).toBeNull();
  });

  it('shows a measured extraction accuracy when there is one', () => {
    mount({ data: { ...REAL, extraction: { status: 'measured', fieldAccuracy: 0.9, reason: null } } });
    expect(tile('v-extraction')).toBe('90.0%');
    expect(screen.queryByTestId('extraction-reason')).toBeNull();
  });

  it('loading shows a skeleton; an error shows retry', () => {
    mount({ loading: true });
    expect(screen.getByRole('status', { name: 'Loading verification' })).toBeInTheDocument();
    cleanup();
    const reload = vi.fn();
    mount({ error: new Error('HTTP 500'), reload });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the verification: HTTP 500');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('VerificationPage navigation (redesign)', () => {
  it('opens with a breadcrumb back to the aggregate and an index of its sections', () => {
    mount({ data: REAL });
    const crumbs = screen.getByTestId('breadcrumb');
    expect(within(crumbs).getByRole('link', { name: 'Aggregate' })).toHaveAttribute('href', '/aggregate');
    const index = screen.getByTestId('section-index');
    expect(within(index).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#v-headline',
      '#v-field',
      '#v-real',
      '#v-strata',
      '#v-disagreements',
      '#v-found',
    ]);
  });

  it('states the three layers as a strip, not an essay', () => {
    mount({ data: REAL });
    expect(within(screen.getByTestId('layer-strip')).getAllByRole('listitem')).toHaveLength(3);
    expect(document.body.textContent).not.toContain('deliberately naive implementation');
  });
});
