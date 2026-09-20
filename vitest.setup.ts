/**
 * Global test guard (BUILD_PLAN rule 5).
 *
 * No test may touch the network. `fetch` is replaced with a wrapper that throws
 * on any non-localhost URL unless RUN_LIVE=1, in which case the real `fetch` is
 * used untouched. Only `*.live.test.ts` files run under RUN_LIVE=1, and only the
 * units that own a live call (F02 snapshot, the Gemini call units) have any.
 */

const LIVE = process.env.RUN_LIVE === '1';

const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
  '0.0.0.0',
]);

export function isLocalFetchTarget(input: unknown): boolean {
  let raw: string;
  if (typeof input === 'string') raw = input;
  else if (input instanceof URL) raw = input.href;
  else if (typeof input === 'object' && input !== null && 'url' in input) {
    raw = String((input as { url: unknown }).url);
  } else {
    return false;
  }

  // Relative URLs never leave the process under jsdom's about:blank origin.
  if (raw.startsWith('/') || raw.startsWith('.')) return true;
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return true;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  if (url.protocol === 'file:' || url.protocol === 'data:' || url.protocol === 'blob:') return true;
  return LOCAL_HOSTNAMES.has(url.hostname);
}

if (!LIVE) {
  const realFetch = globalThis.fetch;
  const guarded: typeof fetch = (input, init) => {
    if (!isLocalFetchTarget(input)) {
      const target =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : String((input as { url?: unknown }).url ?? input);
      return Promise.reject(
        new Error(
          `NETWORK_BLOCKED: test tried to fetch ${target}. ` +
            'Tests are offline by default — use a fixture, the snapshot, or llm/fake-provider. ' +
            'Live calls belong in a *.live.test.ts file run with RUN_LIVE=1.',
        ),
      );
    }
    return realFetch(input, init);
  };
  globalThis.fetch = guarded;
}
