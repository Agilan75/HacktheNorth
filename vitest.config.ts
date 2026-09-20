import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

// Node 24 built-in .env loader. No dotenv dependency (PRD §5 constraints).
// Live tests (RUN_LIVE=1) need ANTHROPIC_API_KEY / FEDERATO_* from the repo-root .env.
const envFile = `${root}.env`;
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // A malformed or unreadable .env must never fail the offline test run.
  }
}

const LIVE = process.env.RUN_LIVE === '1';

/** Every project excludes live tests unless RUN_LIVE=1. */
const exclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/dist-types/**',
  '**/.expo/**',
  ...(LIVE ? [] : ['**/*.live.test.ts', '**/*.live.test.tsx']),
];

const include = ['src/**/*.test.ts', 'src/**/*.test.tsx'];

const setupFiles = [`${root}vitest.setup.ts`];

type ProjectSpec = { name: string; dir: string; environment: 'node' | 'jsdom' };

const specs: ProjectSpec[] = [
  { name: 'engine', dir: 'packages/engine', environment: 'node' },
  { name: 'federato', dir: 'packages/federato', environment: 'node' },
  { name: 'contracts', dir: 'packages/contracts', environment: 'node' },
  { name: 'design', dir: 'packages/design', environment: 'node' },
  { name: 'verify', dir: 'packages/verify', environment: 'node' },
  { name: 'api', dir: 'apps/api', environment: 'node' },
  { name: 'console', dir: 'apps/console', environment: 'jsdom' },
  // Mobile: only the pure logic under src/lib (capture state machine, heading
  // filter, offline queue) runs here. React Native screens are checked by
  // `tsc -p apps/mobile` and on a device, never in node. DECISIONS R3-1.
  { name: 'mobile', dir: 'apps/mobile', environment: 'node' },
];

export default defineConfig({
  test: {
    projects: [
      ...specs.map((spec) => ({
        test: {
          name: spec.name,
          root: `${root}${spec.dir}`,
          environment: spec.environment,
          globals: false,
          include,
          exclude,
          setupFiles,
          // Projects do not inherit the root timeout (R2-10); without this every
          // project ran on vitest's 5 s default, and 4 CPU-heavy tests flaked
          // under a parallel load. DECISIONS CP3-2.
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      })),
      {
        // Cross-package integration tests (Run 2, units I1–I4) live at the repo root.
        test: {
          name: 'integration',
          root,
          environment: 'node' as const,
          globals: false,
          include: ['tests/**/*.test.ts'],
          exclude,
          setupFiles,
          // Projects do not inherit the root testTimeout, so this project sat on
          // vitest's 5 s default. Each integration test seeds the whole real book
          // (all 158 submissions since R2-1), which takes seconds under a full
          // parallel run. DECISIONS R2-10.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
    reporters: ['default'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
