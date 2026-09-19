import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient, GlossaryResponse } from '../api/client.js';

let client: ApiClient;
const getGlossary = vi.fn<() => Promise<GlossaryResponse>>();

vi.mock('../api/useApi.js', () => ({
  useApiClient: () => client,
  useApi: () => {
    throw new Error('not used');
  },
}));

const { Tooltip } = await import('./Tooltip');

const glossary: GlossaryResponse = {
  entries: [
    { term: 'In-Appetite', definition: 'A risk the carrier wants to write.', source: 'Federato glossary, p. 2' },
    { term: 'Premium', definition: 'The price of the policy.', source: 'Federato glossary, p. 1' },
  ],
};

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  getGlossary.mockReset();
  getGlossary.mockResolvedValue(glossary);
  // A fresh client per test, so the per-client glossary cache starts empty.
  client = { getGlossary } as unknown as ApiClient;
});
afterEach(cleanup);

describe('Tooltip', () => {
  it('is keyboard reachable and described by the glossary definition', async () => {
    render(<Tooltip term="in appetite">in appetite</Tooltip>);
    await flush();
    const trigger = screen.getByText('in appetite');
    expect(trigger).toHaveAttribute('tabindex', '0');
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(trigger).toHaveAttribute('aria-describedby', tip.id);
    expect(tip).toHaveTextContent('A risk the carrier wants to write.');
    expect(tip).toHaveTextContent('Source: Federato glossary, p. 2.');
    expect(tip).toHaveAttribute('data-open', 'false');

    fireEvent.focus(trigger);
    expect(tip).toHaveAttribute('data-open', 'true');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(tip).toHaveAttribute('data-open', 'false');
    fireEvent.blur(trigger);
    fireEvent.focus(trigger);
    expect(tip).toHaveAttribute('data-open', 'true');
    fireEvent.blur(trigger);
    expect(tip).toHaveAttribute('data-open', 'false');
  });

  it('opens on hover as well as focus', async () => {
    render(<Tooltip term="Premium">premium</Tooltip>);
    await flush();
    const tip = screen.getByRole('tooltip', { hidden: true });
    fireEvent.mouseEnter(screen.getByText('premium').parentElement!);
    expect(tip).toHaveAttribute('data-open', 'true');
    fireEvent.mouseLeave(screen.getByText('premium').parentElement!);
    expect(tip).toHaveAttribute('data-open', 'false');
  });

  it('matches plurals and fetches the glossary once for many tooltips', async () => {
    render(
      <>
        <Tooltip term="Premiums">a</Tooltip>
        <Tooltip term="PREMIUM">b</Tooltip>
        <Tooltip term="In_Appetite">c</Tooltip>
      </>,
    );
    await flush();
    const tips = screen.getAllByRole('tooltip', { hidden: true });
    expect(tips[0]).toHaveTextContent('The price of the policy.');
    expect(tips[1]).toHaveTextContent('The price of the policy.');
    expect(tips[2]).toHaveTextContent('A risk the carrier wants to write.');
    expect(getGlossary).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback for an unknown term, and a plain message without one', async () => {
    render(
      <>
        <Tooltip term="Adequacy" fallback="Quoted premium divided by predicted premium.">x</Tooltip>
        <Tooltip term="Nonsense">y</Tooltip>
      </>,
    );
    await flush();
    const tips = screen.getAllByRole('tooltip', { hidden: true });
    expect(tips[0]).toHaveTextContent('Quoted premium divided by predicted premium.');
    expect(tips[0]).toHaveAttribute('data-status', 'missing');
    expect(tips[1]).toHaveTextContent('No glossary entry for “Nonsense”.');
  });

  it('falls back when the glossary request fails, and retries on the next mount', async () => {
    getGlossary.mockRejectedValueOnce(new Error('down'));
    const first = render(<Tooltip term="Premium" fallback="Price">p</Tooltip>);
    await flush();
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Price');
    first.unmount();

    render(<Tooltip term="Premium">p</Tooltip>);
    await flush();
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('The price of the policy.');
    expect(getGlossary).toHaveBeenCalledTimes(2);
  });
});
