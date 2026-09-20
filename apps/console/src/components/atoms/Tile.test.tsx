import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Tile } from './Tile.js';

function mount(node: ReactElement) {
  return render(
    <MemoryRouter>
      <dl>{node}</dl>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Tile', () => {
  it('renders the label as the term and the value as the definition', () => {
    mount(<Tile testId="t" label="Fit appetite" value="12" />);
    const tile = screen.getByTestId('t');
    expect(within(tile).getByRole('term')).toHaveTextContent('Fit appetite');
    expect(within(tile).getByRole('definition')).toHaveTextContent('12');
  });

  it('renders the detail under the value when given, and nothing when not', () => {
    mount(<Tile testId="t" label="Fit appetite" value="12" detail="31.6% of the book" />);
    expect(within(screen.getByTestId('t')).getByRole('definition')).toHaveTextContent('31.6% of the book');
    cleanup();
    mount(<Tile testId="t" label="Fit appetite" value="12" />);
    expect(within(screen.getByTestId('t')).getByRole('definition').textContent).toBe('12');
  });

  it('becomes a link over the whole tile when href is set', () => {
    mount(<Tile testId="t" label="Fit appetite" value="12" href="/queue?verdict=FIT" />);
    const link = within(screen.getByTestId('t')).getByRole('link', { name: 'Fit appetite' });
    expect(link).toHaveAttribute('href', '/queue?verdict=FIT');
    expect(link).toHaveStyle({ position: 'absolute' });
  });

  it('has no link when href is absent', () => {
    mount(<Tile testId="t" label="Fit appetite" value="12" />);
    expect(within(screen.getByTestId('t')).queryByRole('link')).toBeNull();
  });

  it('marks its tone so colour is never the only signal', () => {
    mount(<Tile testId="t" label="Disagreements" value="0" tone="positive" />);
    expect(screen.getByTestId('t')).toHaveAttribute('data-tone', 'positive');
  });
});
