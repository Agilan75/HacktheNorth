import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AttachedSweep } from './AttachedSweep.js';
import type { SweepView } from './types.js';

afterEach(cleanup);

const sweep: SweepView = {
  sweepId: 'swp-1',
  roomLabel: 'Loading dock',
  stage: 'done',
  coverage: 83,
  frameCount: 12,
  observations: [
    { id: 'obs-1', label: 'Sprinkler Head', bearing: 40, confidence: 0.92, note: null },
    { id: 'obs-2', label: 'Extension Cord', bearing: 215, confidence: 0.55, note: 'Partly occluded.' },
  ],
};

describe('AttachedSweep', () => {
  it('says so when nothing is attached', () => {
    render(<AttachedSweep sweep={null} />);
    expect(screen.getByText('No photo or sweep is attached to this submission.')).toBeInTheDocument();
  });

  it('renders room, stage, coverage (0..100) and frames', () => {
    render(<AttachedSweep sweep={sweep} />);
    expect(screen.getByTestId('sweep-room')).toHaveTextContent('Loading dock');
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByTestId('sweep-coverage')).toHaveTextContent('83%');
    expect(screen.getByTestId('sweep-coverage')).toHaveTextContent('Sufficient');
    expect(screen.getByTestId('sweep-frames')).toHaveTextContent('12 frames');
  });

  it('treats exactly 75% as sufficient and 74% as below (MIN_COVERAGE_PCT)', () => {
    const { rerender } = render(<AttachedSweep sweep={{ ...sweep, coverage: 75 }} />);
    expect(screen.getByTestId('sweep-coverage')).toHaveTextContent('Sufficient');
    rerender(<AttachedSweep sweep={{ ...sweep, coverage: 74 }} />);
    expect(screen.getByTestId('sweep-coverage')).toHaveTextContent('Below 75%');
  });

  it('lists observations and flags those under 0.6 for confirmation', () => {
    render(<AttachedSweep sweep={sweep} />);
    const rows = screen.getAllByTestId('sweep-observation');
    expect(rows).toHaveLength(2);
    expect(rows[0]!).toHaveTextContent('40°');
    expect(rows[0]!).toHaveTextContent('92%');
    expect(within(rows[0]!).queryByText('Needs confirmation')).toBeNull();
    expect(rows[1]!).toHaveTextContent('215°');
    expect(within(rows[1]!).getByText('Needs confirmation')).toBeInTheDocument();
    expect(rows[1]!).toHaveTextContent('Partly occluded.');
  });

  it('keeps 0.6 exactly out of the confirmation list', () => {
    render(<AttachedSweep sweep={{ ...sweep, observations: [{ ...sweep.observations[0]!, confidence: 0.6 }] }} />);
    expect(screen.queryByText('Needs confirmation')).toBeNull();
  });
});
