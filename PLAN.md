# Retrofit — build plan

One deterministic risk engine, two front ends: a commercial-property
underwriting console driven by the Federato API, and a tenant quoting phone app.
`docs/PRD.md` (v1.2) is the spec. `docs/BUILD_PLAN.md` is the agent
decomposition. This file is the operating plan: how the runs are sequenced, what
versions are pinned, and what gets cut first if time runs out.

---

## 1. Run and checkpoint structure

Four Workflow runs in sequence. Inside a run, units are scheduled by dependency
graph, not by wave — each unit starts the moment its dependencies pass, so the
six concurrent slots stay full. Between runs, the human (not an agent) runs the
heavy commands once, commits, and decides the next run.

| Run | What | Units | Checkpoint |
| --- | --- | --- | --- |
| **Run 0** | Scaffold and contracts. Every module gets its final exported signature and a body of `throw new Error('NOT_IMPLEMENTED:<unit>')`. Nothing is implemented except `util/math.ts` and the design tokens. | 5 (W0-1 … W0-5) | **CP0** — `npm install`; smoke `better-sqlite3` and `sharp` on Node 24; `tsc -b`; `vitest`; commit; tag `cp0-green`. |
| **Run 1** | Phase-1 build. Bodies only — no unit creates a file that Run 0 did not. Engine 17 · Federato 13 · API 20 · Console + design 15 · Verify 9. | 74 | **CP1** — drain, apply contract requests, `tsc -b`, full `vitest` (4 workers), bounded fix loop (group errors by file → owner, ≤ 6 fixers with exclusive files, ≤ 2 rounds, remainder quarantined with `it.skip` + `TODO(blocked)`), commit. |
| **Run 2** | Integration (I1–I4), read-only review (R1–R6), verified fixes, end-to-end smoke (S1). | ~18 | **CP2** — nothing else running: full tests; 100K verify; `npm run verify` for the 10M run with 6 workers (throughput measured at 100K first, and the count actually completed is what gets reported); `verify:llm` (38 real + ~2,000 generated) and the extraction check; `VERIFICATION.md` written from the outputs. Commit, tag. |
| **Run 3** | Phone app (M1–M9), docs (README, DEMO, DECISIONS, STATUS), completeness critic, then the two non-integral extras (Sentry, domain). | ~15 | **CP3** — `tsc -p apps/mobile`, `expo-doctor`, Simulator screens, final tests, commit, tag. |

**Why the skeleton is frozen.** With ~110 agents on one working tree and no
worktrees (8 GB RAM), the only thing that keeps them from colliding is that the
shape of the tree never changes after Run 0. `docs/contracts/OWNERSHIP.json`
maps every path to exactly one unit; `docs/contracts/UNITS.json` lists every
unit with its scope and dependencies. A unit that needs a frozen file changed
writes `docs/contracts/requests/<unit>.md` and carries on with a local
workaround.

**`apps/mobile` is excluded from the root project-reference graph** (root
`tsconfig.json` references the seven non-mobile workspaces only). An Expo or
React Native type problem can therefore never gate phase 1; mobile is checked on
its own with `npm run typecheck --workspace @retrofit/mobile`.

---

## 2. Pinned versions

`.npmrc` sets `save-exact=true`. Every version below is exact, resolved with
`npm view <pkg>@<range> version` on 2026-09-19, and pinned to the range
`docs/BUILD_PLAN.md` names — **not** to the current `latest` dist-tag, several of
which have moved past those ranges (TypeScript is on 7.x, Vitest on 5.x, Vite on
8.x, React Router on 8.x, `@google/genai` on 2.x, `better-sqlite3` on 13.x,
`sharp` on 0.35). The plan's ranges are the tested ones; the tree stays on them.

### Root (`devDependencies`)

| Package | Version | Why |
| --- | --- | --- |
| `typescript` | `5.9.3` | `~5.9`. `erasableSyntaxOnly` needs ≥ 5.8. |
| `tsx` | `4.23.13` | `^4`. Every script runs `node --env-file-if-exists=.env --import tsx <entry>`. |
| `vitest` | `3.2.7` | `^3`. Workspace projects, jsdom project for the console. |
| `@types/node` | `24.13.6` | Node 24. |

### `packages/engine` — pure, deterministic, zero I/O

| Package | Version |
| --- | --- |
| `zod` | `4.6.5` |

### `packages/contracts`

| Package | Version |
| --- | --- |
| `zod` | `4.6.5` |
| `@retrofit/engine` | workspace |

### `packages/federato`

| Package | Version |
| --- | --- |
| `zod` | `4.6.5` |
| `@retrofit/engine`, `@retrofit/contracts` | workspace |

### `packages/design`

No runtime dependencies. Tokens are plain TypeScript (PRD §13).

### `packages/verify`

| Package | Version | Why |
| --- | --- | --- |
| `fast-check` | `4.10.1` | `^4`. Layer A property tests. |
| `zod` | `4.6.5` | |
| `@retrofit/engine`, `@retrofit/contracts`, `@retrofit/api` | workspace | `@retrofit/api` only for the layer-C `second-opinion` call (V09 → A05). |

### `apps/api`

| Package | Version | Why |
| --- | --- | --- |
| `hono` | `4.13.8` | `^4` |
| `@hono/node-server` | `1.19.17` | peer `hono@^4`; the 2.x line is not pinned here |
| `drizzle-orm` | `0.45.2` | no `drizzle-kit`; migration is hand-written `CREATE TABLE IF NOT EXISTS` |
| `better-sqlite3` | `12.11.1` | `^12`. Fallback if it will not build on Node 24: `drizzle-orm/sqlite-proxy` over `node:sqlite`, confined to `src/db/client.ts`. |
| `@types/better-sqlite3` | `7.6.13` | dev |
| `sharp` | `0.34.5` | `^0.34`. Image metrics and test assets. |
| `@google/genai` | `1.52.0` | `^1`. Model chain `gemini-3.6-flash` → `3.8` → `3.5`, with `3.7` in reserve. |
| `@sentry/node` | `10.75.0` | unused until Run 3 (X1) |
| `zod` | `4.6.5` | |

### `apps/console`

| Package | Version | Why |
| --- | --- | --- |
| `react`, `react-dom` | `19.2.3` | **pinned to what Expo SDK 57 expects**, so console and mobile share one React |
| `react-router` | `7.18.4` | `^7` |
| `@fontsource-variable/fraunces` | `5.3.0` | fonts available without wifi (PRD §13) |
| `@fontsource-variable/inter` | `5.3.0` | |
| `@sentry/react` | `10.75.0` | unused until Run 3 (X1) |
| `vite` | `7.3.6` | `^7` (dev) |
| `@vitejs/plugin-react` | `4.7.0` | dev; peer range covers Vite 7. The 6.x line requires Vite 8. |
| `@types/react` | `19.2.18` | dev; `~19.2.2`, Expo's range |
| `@types/react-dom` | `19.2.7` | dev |
| `@testing-library/react` | `16.3.3` | dev |
| `@testing-library/dom` | `10.4.2` | dev |
| `@testing-library/jest-dom` | `6.10.0` | dev |
| `jsdom` | `26.1.0` | dev; the console vitest project's environment |

### `apps/mobile` — the Expo SDK 57 set

Versions are those `expo-template-blank-typescript@57.0.26` and Expo SDK 57
expect. The template's own `typescript@~6.0.3` is **not** adopted; the whole repo
stays on 5.9.3 (one TypeScript, one `tsc`).

| Package | Version |
| --- | --- |
| `expo` | `57.0.24` |
| `react` | `19.2.3` |
| `react-native` | `0.86.3` |
| `expo-status-bar` | `57.0.1` |
| `expo-router` | `57.0.22` |
| `expo-camera` | `57.0.5` |
| `expo-sensors` | `57.0.3` |
| `expo-haptics` | `57.0.3` |
| `expo-image-manipulator` | `57.0.19` |
| `expo-file-system` | `57.0.7` |
| `expo-linking` | `57.0.10` |
| `react-native-safe-area-context` | `5.10.0` |
| `react-native-screens` | `4.28.0` |
| `react-native-gesture-handler` | `3.3.0` |
| `react-native-reanimated` | `4.7.0` |
| `react-native-worklets` | `0.12.2` |
| `@shopify/react-native-skia` | `2.12.0` |
| `@babel/core` | `7.29.7` (dev) |
| `@types/react` | `19.2.18` (dev) |

**Not used anywhere, by decision:** eslint, prettier, Tailwind, dotenv (Node 24's
`--env-file-if-exists` and `process.loadEnvFile` cover it), drizzle-kit, Python,
Docker, pnpm.

**If `npm install` hits an Expo peer conflict at CP0:** remove `apps/mobile` from
the root `workspaces` array and give it its own install in Run 3. Nothing in
phase 1 depends on it.

---

## 3. Scripts

| Script | Command |
| --- | --- |
| `npm run dev:api` | `node --env-file-if-exists=.env --import tsx --watch apps/api/src/index.ts` |
| `npm run dev:console` | Vite dev server in `apps/console` |
| `npm run build:console` | `vite build` |
| `npm run seed` | `node --env-file-if-exists=.env --import tsx apps/api/src/scripts/seed.ts` |
| `npm run federato:snapshot` | refreshes the mock snapshot from the live API (the only live Federato caller) |
| `npm run rating:fit` | fits the monotonic rating table from the real policies |
| `npm run verify` | layers A + B, 10 million cases, 6 workers |
| `npm run verify:llm` | layer C — 38 real + ~2,000 stratified generated |
| `npm test` | `vitest run` — every project, `*.live.test.ts` excluded |
| `npm run test:live` | `RUN_LIVE=1 vitest run` — includes the live smokes |
| `npm run typecheck` | `tsc -b` over the seven non-mobile workspaces |

`vitest.setup.ts` replaces `fetch` with a guard that rejects any non-localhost
URL unless `RUN_LIVE=1`, so an accidental live call in a unit test fails loudly
instead of costing money or hanging on venue wifi.

---

## 4. Cut ladder

Cut from the bottom up. Everything above a cut line still demos.

| # | Cut | Cost | Why it is safe |
| --- | --- | --- | --- |
| 1 | **GoDaddy domain** (X2) | A line in STATUS.md | Nothing points at it. |
| 2 | **Sentry** (X1) | The Sentry prize | Wired through a no-op observability hook created in Run 0, so cutting it needs no edit to `app.ts`. |
| 3 | **`/aggregate` page and service** (C14, A19, A13 half) | One console route | The portfolio numbers are a nice-to-have; the queue carries the story. |
| 4 | **Layer C** (V09, `verify:llm`) | One paragraph of `VERIFICATION.md` | Layer B is the real correctness check; layer C shares a vendor with the app and is stated as the weaker check. |
| 5 | **The 10M run drops to whatever completed** | A number | The plan is explicit: report the count actually run, never a number that was not run. |
| 6 | **Enrichment drops to one plugin** (flood only; A08 cut) | One card in the console | Each plugin must be able to move a score, a premium, or raise a contradiction; if Overpass is slow or down, flood alone still proves the pattern. |
| 7 | **The phone app** (M1–M9, Run 3) | The Intact prize | Phase 1 alone is a complete Federato and Rox entry. This is the stated fallback in PRD §16. |
| 8 | **Sweep pipeline server-side** (A18, E12, A09) | The Intact prize and the sweep panels | Only reachable once the phone app is already cut. |

What is **never** cut, because the entry dies without it: the query planner with
its trace (§7.5), the rulebook scoring with citations (§6), the action loop
(§7.6), the ranked queue and submission detail (§10), and layers A + B of
verification (§12).

---

## 5. Standing risks carried into the build

- **Venue wifi or the Federato API fails mid-demo** → the snapshot adapter
  implements the same `query` contract; unsetting `FEDERATO_BASE_URL` switches to
  it with no code change, and a loud banner says which is active.
- **`better-sqlite3` will not build on Node 24** → `node:sqlite` via
  `drizzle-orm/sqlite-proxy`, confined to one file.
- **Gemini overload or bad JSON** → model chain, enforced `responseSchema`,
  generous `maxOutputTokens` (thinking is on by default), one retry, then a
  seeded fallback.
- **The naive verify implementation is only isolated by instruction** → it is
  scheduled first, while `packages/engine/src` holds nothing but stubs, and CP1
  greps for any `@retrofit/engine` import under `packages/verify/src/naive`.
- **The camera sweep cannot be verified by an agent** → Run 3 ships a human
  checklist in STATUS.md.
