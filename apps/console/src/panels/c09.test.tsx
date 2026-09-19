import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Buildings } from './Buildings';
import { Contradictions } from './Contradictions';
import type {
  BuildingRowView,
  ContradictionView,
  InterpretationView,
  RollupView,
} from './types';

afterEach(cleanup);

// INTERPRETATIONS.md vector B6: OH, TIV 150,000,000, pctTivPre1990 = 0.5 (one building at 1989),
// pctTivPost2010 = 0, pctTivAcceptableConstruction = 0.5, five-year loss 100,000.
const rollup: RollupView = {
  totalTiv: 150_000_000,
  buildingCount: 2,
  pctTivPre1990: 0.5,
  pctTivPost2010: 0,
  pctTivAcceptableConstruction: 0.5,
  primaryState: 'OH',
  fiveYearLoss: 100_000,
};

const buildings: readonly BuildingRowView[] = [
  {
    id: 'B-2', address: '2 Main St', state: 'OH', yearBuilt: 1995, constructionType: 'joisted_masonry',
    tiv: 75_000_000, sprinklered: true, protectionClass: 3, flags: [],
  },
  {
    id: 'B-1', address: null, state: 'OH', yearBuilt: 1989, constructionType: null,
    tiv: 75_000_000, sprinklered: null, protectionClass: null, flags: ['pre-1990'],
  },
];

function rollupValue(term: string): string {
  return screen.getByTestId(`rollup-${term}`).querySelector('dd')!.textContent ?? '';
}

describe('Buildings (PRD 10 e)', () => {
  it('renders the rollup exactly as the engine returned it', () => {
    render(<Buildings buildings={buildings} rollup={rollup} />);
    expect(screen.getByRole('region', { name: 'Buildings' })).toHaveAttribute('id', 'e');
    expect(rollupValue('Total TIV')).toBe('$150.0M');
    expect(rollupValue('Buildings')).toBe('2');
    expect(rollupValue('TIV pre-1990')).toBe('50.0%');
    expect(rollupValue('TIV 2010 or newer')).toBe('0.0%');
    expect(rollupValue('TIV in acceptable construction')).toBe('50.0%');
    expect(rollupValue('Primary state')).toBe('OH');
    expect(rollupValue('Five-year loss')).toBe('$100,000');
    expect(screen.getByText('2 buildings')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('renders each building row with words for unknowns and flags as labelled badges', () => {
    render(<Buildings buildings={buildings} rollup={rollup} />);
    const table = screen.getByRole('table', { name: 'Schedule of buildings' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!).getAllByRole('cell').map((c) => c.textContent);
    expect(first).toEqual(['B-2', '2 Main St', 'OH', '1995', 'Joisted Masonry', '$75.0M', 'Yes', '3', 'None']);
    const second = within(rows[1]!).getAllByRole('cell').map((c) => c.textContent);
    expect(second).toEqual(['B-1', 'Not reported', 'OH', '1989', 'Not reported', '$75.0M', 'Not reported', 'Not reported', 'pre-1990']);
  });

  it('sorts by year built', () => {
    render(<Buildings buildings={buildings} rollup={rollup} />);
    const header = screen.getByRole('columnheader', { name: /Year built/ });
    fireEvent.click(within(header).getByRole('button'));
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getAllByRole('cell')[0]!.textContent).toBe('B-1');
  });

  it('says when the table holds fewer buildings than the rollup, and handles an empty schedule', () => {
    render(
      <Buildings
        buildings={[]}
        rollup={{ ...rollup, buildingCount: 129, totalTiv: null, pctTivPre1990: null, fiveYearLoss: null }}
      />,
    );
    expect(screen.getByText(/Showing 0 buildings of 129/)).toBeInTheDocument();
    expect(screen.getByText('No buildings on this submission.')).toBeInTheDocument();
    expect(rollupValue('Total TIV')).toBe('—');
    expect(rollupValue('TIV pre-1990')).toBe('—');
    expect(rollupValue('Five-year loss')).toBe('—');
  });
});

const contradictions: readonly ContradictionView[] = [
  {
    id: 'c-low', field: 'buildings[0].sprinklered', severity: 'LOW', status: 'open',
    summary: 'Sprinkler status differs.',
    sides: [{ value: 'Yes', source: 'self_reported', confidence: 0.6 }],
  },
  {
    id: 'c-res', field: 'rollup.primaryState', severity: 'HIGH', status: 'resolved',
    summary: 'State resolved by broker answer.', sides: [],
  },
  {
    id: 'c-high', field: 'buildings[1].yearBuilt', severity: 'HIGH', status: 'open',
    summary: 'Year built disagrees between the application and the sweep.',
    sides: [
      { value: '1989', source: 'self_reported', confidence: 0.6 },
      { value: '2012', source: 'sweep', confidence: 0.85 },
    ],
  },
];

const interpretations: readonly InterpretationView[] = [
  {
    id: 'R-AGE-REFER', title: 'Any building pre-1990 versus >50% of TIV pre-1990',
    text: 'At exactly 0.5 the factor stays Acceptable and the refer rule fires.',
    citation: { document: 'Property Appetite Guide', page: 3, row: 'Building age', quote: 'REFER when any building is pre-1990' },
  },
  { id: 'I-2', title: 'No citation', text: 'Plain text.', citation: null },
];

describe('Contradictions (PRD 10 f)', () => {
  it('orders open before resolved and HIGH before LOW, with sides and confidences', () => {
    render(<Contradictions contradictions={contradictions} interpretations={interpretations} />);
    const region = screen.getByRole('region', { name: 'Contradictions and interpretations' });
    expect(region).toHaveAttribute('id', 'f');
    const items = screen.getAllByTestId('contradiction');
    expect(items.map((i) => i.querySelector('code')!.textContent)).toEqual([
      'buildings[1].yearBuilt',
      'buildings[0].sprinklered',
      'rollup.primaryState',
    ]);
    expect(within(items[0]!).getByText('HIGH severity')).toHaveAttribute('data-tone', 'attention');
    expect(within(items[0]!).getByText(/V-3/)).toBeInTheDocument();
    expect(within(items[2]!).queryByText(/V-3/)).toBeNull();
    expect(within(items[2]!).getByText('Resolved')).toBeInTheDocument();
    const cells = within(items[0]!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['1989', 'Self-reported', '60%', '2012', 'Sweep', '85%']);
    expect(screen.getByText('2 open of 3')).toHaveAttribute('title', '1 open HIGH contradiction');
  });

  it('lists interpretations with their citation quote', () => {
    render(<Contradictions contradictions={contradictions} interpretations={interpretations} />);
    const items = screen.getAllByTestId('interpretation');
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('blockquote')!.textContent).toBe('“REFER when any building is pre-1990”');
    expect(items[0]!.querySelector('cite')!.textContent).toBe('Property Appetite Guide · p. 3 · row Building age');
    expect(items[1]!.querySelector('blockquote')).toBeNull();
  });

  it('renders empty states', () => {
    render(<Contradictions contradictions={[]} interpretations={[]} />);
    expect(screen.getByText('No contradictions')).toHaveAttribute('data-tone', 'quiet');
    expect(screen.getByText('No contradictions between sources.')).toBeInTheDocument();
    expect(screen.getByText('No guideline interpretations were needed for this submission.')).toBeInTheDocument();
  });
});
