import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Vector } from './Vector.js';
import type { VectorComponentView, VectorView } from './types.js';

afterEach(cleanup);

/** PRD 6.4 commercial spec; immovable per INTERPRETATIONS F-2 (0,1,2,5,6,8,10). */
const SPEC: readonly (readonly [string, string, boolean, boolean])[] = [
  ['isNewBusiness', 'New business', true, true],
  ['isPropertyLine', 'Property line of business', true, true],
  ['stateTier', 'Primary risk state tier', true, true],
  ['totalTiv', 'Total insured value', false, true],
  ['quotedPremium', 'Quoted total premium', false, true],
  ['pctTivPre1990', 'Share of TIV built before 1990', true, true],
  ['pctTivPost2010', 'Share of TIV built in 2010 or later', true, true],
  ['pctTivAcceptableConstruction', 'Share of TIV in acceptable construction', false, true],
  ['fiveYearLoss', 'Five-year loss value', true, true],
  ['pctTivSprinklered', 'Share of TIV sprinklered', false, false],
  ['tivWeightedProtectionClass', 'TIV-weighted protection class', true, false],
];

function vector(rows: readonly (readonly [number | null, number | null])[], completeness: number): VectorView {
  const components: VectorComponentView[] = SPEC.map(([key, label, immovable, appetiteFactor], index) => {
    const [raw, tier] = rows[index] ?? [null, null];
    return {
      index,
      key,
      label,
      raw,
      tier: raw === null ? null : tier,
      mask: raw === null ? 0 : 1,
      scaled: raw === null ? null : 0.5,
      immovable,
      appetiteFactor,
    };
  });
  return { lineOfBusiness: 'commercial_property', specVersion: '1.0.0', components, completeness };
}

/** INTERPRETATIONS B2: as B1 but TIV 150,000,000.01 → tier 0 (knockout). */
const B2 = vector(
  [
    [1, 1],
    [1, 1],
    [2, 1],
    [150000000.01, 0],
    [175000, 0.6],
    [0, 0.6],
    [0, 0.6],
    [0.5, 1],
    [100000, 1],
    [0.5, null],
    [4, null],
  ],
  100,
);

describe('Vector', () => {
  it('renders all eleven components in order with raw, tier and mask', () => {
    render(<Vector vector={B2} />);
    const table = screen.getByRole('table', { name: 'Feature vector' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(11);
    expect(screen.getByTestId('vector-raw-totalTiv')).toHaveTextContent('$150,000,000');
    expect(screen.getByTestId('vector-raw-totalTiv')).toHaveAttribute('title', '150000000.01');
    expect(screen.getByTestId('vector-raw-quotedPremium')).toHaveTextContent('$175,000');
    expect(screen.getByTestId('vector-raw-pctTivAcceptableConstruction')).toHaveTextContent('50.0%');
    expect(screen.getByTestId('vector-raw-stateTier')).toHaveTextContent('2 (target)');
    expect(screen.getByTestId('vector-raw-isNewBusiness')).toHaveTextContent('1 (yes)');
    expect(screen.getByTestId('vector-raw-tivWeightedProtectionClass')).toHaveTextContent('4.0');
    expect(screen.getByTestId('vector-tier-quotedPremium')).toHaveTextContent('0.6 · Acceptable');
    // T-BLANK: loss value has no Target column; tier 1 is Acceptable, as panel (b) says.
    expect(screen.getByTestId('vector-tier-fiveYearLoss')).toHaveTextContent('1 · Acceptable');
    expect(screen.getByTestId('vector-mask-totalTiv')).toHaveTextContent('1 · known');
    expect(screen.getByTestId('vector-completeness')).toHaveTextContent('100.0%');
    expect(screen.getByTestId('vector-known')).toHaveTextContent('11 of 11');
  });

  it('G-3: a known appetite component at tier 0 is marked knockout; only that one', () => {
    render(<Vector vector={B2} />);
    expect(screen.getByTestId('vector-row-totalTiv')).toHaveAttribute('data-knockout', 'true');
    expect(screen.getByTestId('vector-tier-totalTiv')).toHaveTextContent('0 · Not acceptable');
    expect(screen.getAllByText('Knockout')).toHaveLength(1);
    // pctTivPre1990 raw is 0 but its tier is 0.6: a zero raw is not a knockout.
    expect(screen.getByTestId('vector-row-pctTivPre1990')).toHaveAttribute('data-knockout', 'false');
  });

  it('F-2: immovable components 0,1,2,5,6,8,10 are labelled; 3,4,7,9 are movable', () => {
    render(<Vector vector={B2} />);
    const immovable = SPEC.filter((s) => s[2]).map((s) => s[0]);
    const movable = SPEC.filter((s) => !s[2]).map((s) => s[0]);
    expect(immovable).toHaveLength(7);
    for (const key of immovable) expect(screen.getByTestId(`vector-movable-${key}`)).toHaveTextContent('Immovable');
    for (const key of movable) expect(screen.getByTestId(`vector-movable-${key}`)).toHaveTextContent('Movable');
    // Components 9 and 10 are not appetite factors.
    expect(screen.getByTestId('vector-tier-pctTivSprinklered')).toHaveTextContent('Not scored');
  });

  it('R5-10 / T-BLANK: tier 1 on a blank-Target factor reads Acceptable, elsewhere Target', () => {
    render(<Vector vector={B2} />);
    for (const key of ['isNewBusiness', 'isPropertyLine', 'pctTivAcceptableConstruction', 'fiveYearLoss']) {
      expect(screen.getByTestId(`vector-tier-${key}`)).toHaveTextContent('1 · Acceptable');
      expect(screen.getByTestId(`vector-tier-${key}`)).not.toHaveTextContent('Target');
    }
    expect(screen.getByTestId('vector-tier-stateTier')).toHaveTextContent('1 · Target');
  });

  it('T-SPAN: notes that components 5 and 6 share the building-age tier', () => {
    render(<Vector vector={B2} />);
    expect(screen.getByTestId('vector-tspan-note')).toHaveTextContent('eight factors, not eleven components');
  });

  it('no policy: missing components show mask 0, no tier, and V-6 completeness 11.1%', () => {
    render(<Vector vector={vector([[null, null], [1, 1]], 100 / 9)} />);
    expect(screen.getByTestId('vector-raw-isNewBusiness')).toHaveTextContent('Missing');
    expect(screen.getByTestId('vector-mask-isNewBusiness')).toHaveTextContent('0 · missing');
    expect(screen.getByTestId('vector-row-isNewBusiness')).toHaveAttribute('data-mask', '0');
    expect(screen.getByTestId('vector-tier-totalTiv')).toHaveTextContent('—');
    expect(screen.getByTestId('vector-scaled-totalTiv')).toHaveTextContent('—');
    expect(screen.getByTestId('vector-completeness')).toHaveTextContent('11.1%');
    expect(screen.getByTestId('vector-known')).toHaveTextContent('1 of 11');
    expect(screen.queryByText('Knockout')).toBeNull();
  });
});
