import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AsyncState } from '../api/useApi';
import type { HealthResponse } from '../api/client';

const state: { current: AsyncState<HealthResponse> } = {
  current: { data: null, loading: true, error: null, reload: () => {} },
};

vi.mock('../api/useApi.js', () => ({
  useApi: vi.fn(() => state.current),
  useApiClient: vi.fn(),
}));

const { AdapterBanner } = await import('./AdapterBanner');
const { useApi } = await import('../api/useApi.js');

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(useApi).mockClear();
});

describe('AdapterBanner', () => {
  it('states "Live Federato API" in words with role=status when kind=live', () => {
    render(<AdapterBanner kind="live" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Live Federato API');
    expect(status).toHaveAttribute('data-adapter', 'live');
    expect(useApi).not.toHaveBeenCalled();
  });

  it('states "Snapshot" when kind=snapshot', () => {
    render(<AdapterBanner kind="snapshot" />);
    expect(screen.getByRole('status')).toHaveTextContent('Snapshot');
    expect(screen.getByRole('status')).not.toHaveTextContent('Live');
  });

  it('reads GET /health when kind is omitted', () => {
    state.current = {
      data: { ok: true, adapter: 'snapshot', version: '0.1.0' },
      loading: false,
      error: null,
      reload: () => {},
    };
    render(<AdapterBanner />);
    expect(useApi).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Snapshot');

    cleanup();
    state.current = { ...state.current, data: { ok: true, adapter: 'live', version: '0.1.0' } };
    render(<AdapterBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Live Federato API');
  });

  it('never disappears: renders while loading and on error', () => {
    state.current = { data: null, loading: true, error: null, reload: () => {} };
    render(<AdapterBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking data source');

    cleanup();
    state.current = { data: null, loading: false, error: new Error('down'), reload: () => {} };
    render(<AdapterBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Data source unknown');
    expect(screen.getByRole('status')).toHaveAttribute('data-adapter', 'unknown');
  });
});
