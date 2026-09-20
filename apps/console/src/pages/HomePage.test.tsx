import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { HomePage } from './HomePage.js';

afterEach(cleanup);

function renderHome(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  it('leads with the wordmark and the thesis', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Retrofit' })).toBeInTheDocument();
    expect(
      screen.getByText('Underwriting runs on what the broker typed. We built the camera that checks.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Gemini sees; the engine decides.')).toBeInTheDocument();
  });

  it('shows the pipeline as a labelled region with its sources, hub, surfaces and stages', () => {
    renderHome();
    const pipeline = screen.getByRole('region', { name: 'The pipeline' });
    expect(within(pipeline).getByText('Federato API')).toBeInTheDocument();
    expect(within(pipeline).getByText('iPhone sweep')).toBeInTheDocument();
    expect(within(pipeline).getByText('apps/api')).toBeInTheDocument();
    expect(within(pipeline).getByText('packages/engine')).toBeInTheDocument();
    expect(within(pipeline).getByText(/records \+ query trace/)).toBeInTheDocument();
    expect(within(pipeline).getByText(/photos \+ bearings/)).toBeInTheDocument();
    const stages = within(pipeline).getByRole('list', { name: 'Engine stages, in order' });
    expect(within(stages).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'normalizeone canonical record',
      'rollupTIV, states, ages, losses',
      'mergeenrichment, answers, camera',
      'vectorizevalues become tiers',
      'evaluatetiers become a score',
      'price + verdictpremium and deciding rule',
    ]);
  });

  it('points the primary call to action at the queue', () => {
    renderHome();
    expect(screen.getByRole('link', { name: 'Open the queue' })).toHaveAttribute('href', '/queue');
  });

  it('reports the planner run and the stack without a credential', () => {
    renderHome();
    expect(screen.getByText('4 planner queries')).toBeInTheDocument();
    expect(screen.getByText('9.2 s')).toBeInTheDocument();
    expect(screen.getByText('158 submissions stored and scored')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'trace' })).toHaveAttribute('href', '/queue');
    expect(screen.getByText(/zero I\/O, no clock, no randomness/)).toBeInTheDocument();
  });

  it('offers a rail of the five console pages', () => {
    renderHome();
    const rail = within(screen.getByRole('region', { name: 'In the console' })).getByRole('list');
    const links = within(rail).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/queue',
      '/rules',
      '/aggregate',
      '/explore',
      '/verification',
    ]);
    expect(within(rail).getByText('Verification')).toBeInTheDocument();
  });
});
