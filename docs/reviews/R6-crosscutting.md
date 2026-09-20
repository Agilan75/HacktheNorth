# R6: cross-cutting review (engine purity, env and secrets, ignore rules, prototype)

Reviewer: R6. Read-only. Only this file was written.

## What I checked

| Check | Result |
| --- | --- |
| `Date.now`, `new Date()` with no args, `Math.random`, `performance.now` in `packages/engine/src` (non-test) | **Clean.** The only hits are doc comments. `util/fields.ts:55` calls `Date.parse(observedAt)`, which is parsing and not a clock read. |
| fs/net I/O in `packages/engine/src` | `data.ts` (sanctioned). There are two more: `fixtures/real.ts` (`readFileSync` of the snapshot) and `scripts/fit.ts` (`writeFileSync` of `rating/commercial.json`). The barrel exports neither and no stage imports either. They are recorded in docs/decisions/E17.md D-1 and are CLI or test support only. **Accepted.** |
| `process.env` outside `apps/api/src/env.ts` | `vitest.config.ts` and `vitest.setup.ts` are test harness config. `packages/verify/src/worker.ts:105-106` is the test-only fault hook, fenced on `VITEST`, and recorded as **DECISIONS CP1-11**. It is not re-litigated here. No other code reads it. The console has no env access except the public `VITE_API_URL`. Mobile uses `EXPO_PUBLIC_API_URL` through app.json. |
| GEMINI_API_KEY path | env.ts → `index.ts`/`seed.ts`/`cli-llm.ts` → `createGeminiProvider`. The key goes only in the `x-goog-api-key` header and never in a URL. `VisionError` messages carry Gemini's error text, never the key. Banners and `describeEnv` are booleans only. |
| FEDERATO_CLIENT_SECRET / bearer path | env.ts `federatoEnv` → `auth.ts` POST body only. `TokenMintError` carries Auth0's `error`/`error_description`, never the secret. The bearer token is used only in `live-adapter.ts:173` as a request header. It is never placed in a trace, a DTO, an error, or a log. `adapterBanner` prints only the host and the names of missing keys. |
| HTTP responses | `app.onError` returns `error.message` verbatim. I checked every error class that can reach it (TokenMintError, FederatoApiError, VisionError, LlmUnavailableError). None puts a credential in its message. `/health` returns only adapter kind, the llmConfigured boolean, a count, the version, and startedAt. |
| Console bundle | It imports only `@retrofit/contracts` and `@retrofit/design`. Neither imports `@retrofit/api`, `node:*`, or `process`. Sentry is not wired, and there is no DSN in the bundle. |
| Committed files | I scanned every tracked file for Gemini key shapes (`AIza…`), JWTs (`eyJ….`) and literal `client_secret` values: 0 hits. The snapshot JSONs contain 0 `access_token`/`client_secret`/`client_id`/`authorization` keys. `.env` is not tracked. |
| `.gitignore` | Covers `.env` and `.env.*` (with `!.env.example`), `apps/api/data/*.db*` (including `-wal`/`-shm`), `probe-output.json`, `dist/`, and `*.tsbuildinfo`. **Gap: see R6-1.** |
| `prototype/` | `git diff --stat main -- prototype` is empty. The working tree is clean under `prototype/` and nothing there is untracked. **Unmodified.** |

## Findings

### R6-1 (MAJOR): the default DATABASE_URL is cwd-relative, so the api package's own `dev`/`start` scripts open a different, empty, un-ignored database

`apps/api/src/env.ts:39` defaults `DATABASE_URL` to the relative path `apps/api/data/retrofit.db`, and `.env.example` does not set it. `db/client.ts` passes the string straight to `mkdirSync(dirname(url))` and `new Database(url)`, so the path resolves against the process cwd:

- `npm run seed` and `npm run dev:api` run from the repo root and use `<root>/apps/api/data/retrofit.db`.
- `npm run dev -w @retrofit/api` and `npm start -w @retrofit/api` run with cwd `apps/api` and use `<root>/apps/api/apps/api/data/retrofit.db`. `main()` migrates that fresh file, so the API serves an empty queue after a successful seed.
- That second path is **not** covered by `.gitignore` (`apps/api/data/*.db*` is anchored at the root). A careless `git add -A` would commit a database of submission data.

Repro:

```
cd apps/api && node -e "console.log(require('path').resolve('apps/api/data/retrofit.db'))"
# -> <root>/apps/api/apps/api/data/retrofit.db
git check-ignore -v apps/api/apps/api/data/retrofit.db || echo NOT_IGNORED
# -> NOT_IGNORED
```

Fix: resolve the default against the module location, for example `fileURLToPath(new URL('../data/retrofit.db', import.meta.url))`, or resolve a relative `DATABASE_URL` against the repo root in `env.ts`. Either change touches env.ts, which is frozen and needs a contract request. Alternatively, add `**/data/*.db*` to `.gitignore`.

### R6-2 (MINOR): engine tie-breaks use ambient-locale `localeCompare`, so identical input can give a different primary state on another machine

`rollup.ts:329` breaks equal-TIV state ties with `a.state.localeCompare(b.state)`, and that picks `primaryState`. `rollup.ts:279` (construction share order) and `discover.ts:358/366/464-467` and `normalize.ts:341` (resource and path order) use the same call. None of them passes a locale, so the result depends on the host ICU default locale. That breaks PRD §15 "same input gives same output" across machines. The differential cannot see it because the naive oracle takes `primaryState` as an input and never re-derives it.

Repro:

```
node -e "console.log(['NJ','NY'].sort((a,b)=>a.localeCompare(b,'lt')), ['NJ','NY'].sort((a,b)=>a.localeCompare(b,'en')))"
# -> [ 'NY', 'NJ' ] [ 'NJ', 'NY' ]
```

A submission with equal known TIV in NJ and NY gets primaryState NY on an `lt` host and NJ on an `en` host. That changes the state-tier factor and possibly the verdict. Fix: use a code-unit compare (`a < b ? -1 : a > b ? 1 : 0`) or `localeCompare(b, 'en')`.

## Notes (not findings)

- `apps/console/dist-types/` (272 files of `tsc -b` emit) is tracked in git and not ignored. It currently matches the source, so nothing is stale today. Any rebuild rewrites it, though, and build output has no business in the tree.
- `systemClock().today()` (`apps/api/src/services/types.ts:60`) is the UTC date. It is used as `asOf` in rescore/sweep. After 20:00 EDT it is tomorrow's date. That has no numeric effect except at a year boundary, so it is not raised as a finding.
