import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './fit';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rating:fit CLI', () => {
  it('prints usage and exits 0 on --help without touching the snapshot', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(['--help'])).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toContain('usage: rating:fit');
  });

  it('rejects an unknown flag with exit code 2', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['--bogus'])).toBe(2);
    expect(String(err.mock.calls[0]?.[0])).toContain('unknown argument: --bogus');
  });

  it('rejects bad option values with exit code 2', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['--tolerance', '-1'])).toBe(2);
    expect(await main(['--max-iterations=0'])).toBe(2);
    expect(await main(['--fitted-at', 'not-a-date'])).toBe(2);
    expect(await main(['--out'])).toBe(2);
  });
});
