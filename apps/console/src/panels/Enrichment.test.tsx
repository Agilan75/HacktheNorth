import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Enrichment } from './Enrichment.js';
import type { EnrichmentCardView } from './types.js';

afterEach(cleanup);

const FEMA: EnrichmentCardView = {
  source: 'openfema',
  title: 'Flood zone (OpenFEMA)',
  available: true,
  unavailableReason: null,
  fetchedAt: '2026-09-19T12:00:00.000Z',
  rows: [
    { label: 'Flood zone', value: 'X (minimal hazard)' },
    { label: 'Special flood hazard area', value: 'No' },
  ],
};

const OVERPASS_DOWN: EnrichmentCardView = {
  source: 'overpass',
  title: 'Nearest fire station (OpenStreetMap)',
  available: false,
  unavailableReason: 'Timed out after 6 s',
  fetchedAt: null,
  rows: [],
};

describe('Enrichment', () => {
  it('renders an available card with every row and the fetch date', () => {
    render(<Enrichment cards={[FEMA, OVERPASS_DOWN]} />);
    const card = screen.getByTestId('enrichment-card-openfema');
    expect(card).toHaveAttribute('data-available', 'true');
    expect(within(card).getByRole('heading', { name: 'Flood zone (OpenFEMA)' })).toBeInTheDocument();
    expect(within(card).getByText('X (minimal hazard)')).toBeInTheDocument();
    expect(within(card).getByText('Special flood hazard area')).toBeInTheDocument();
    expect(within(card).getByText('Fetched Sep 19, 2026')).toBeInTheDocument();
    expect(within(card).getByText('Available')).toBeInTheDocument();
  });

  it('PRD 8: keeps the unavailable card, with its reason, in text not colour', () => {
    render(<Enrichment cards={[FEMA, OVERPASS_DOWN]} />);
    const card = screen.getByTestId('enrichment-card-overpass');
    expect(card).toHaveAttribute('data-available', 'false');
    expect(within(card).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('enrichment-reason-overpass')).toHaveTextContent('Timed out after 6 s');
    expect(screen.getByTestId('enrichment-summary')).toHaveTextContent('1 of 2 sources available');
  });

  it('falls back to a generic reason when none is given', () => {
    render(<Enrichment cards={[{ ...OVERPASS_DOWN, unavailableReason: null }]} />);
    expect(screen.getByTestId('enrichment-reason-overpass')).toHaveTextContent('could not be reached');
    expect(screen.getByTestId('enrichment-summary')).toHaveTextContent('0 of 1 source available');
  });

  it('says so when no enrichment has run', () => {
    render(<Enrichment cards={[]} />);
    expect(screen.getByText('No enrichment has run for this submission yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('enrichment-summary')).toBeNull();
  });
});
