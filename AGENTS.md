# AGENTS.md — the rules every Retrofit build agent receives

Read this whole file before writing a line. It is the contract that keeps ~110
parallel agents from destroying each other's work. If this file and your task
prompt disagree, your task prompt wins for *what* to build; this file wins for
*how* to behave in the tree.

---

## 0. Ground facts about this repository

1. **The monorepo is the repository root**: `/Users/calebchincalebchin/hackthenorth`.
   `packages/` and `apps/` sit beside `docs/` and `prototype/`. Any path in an
   older document that reads `retrofit/x` means `x`.
2. **`prototype/` is frozen.** It is read-only source material (the working
   vision demo). No unit owns it. Never create, edit, or delete anything in it.
3. **`.env` exists at the repo root and holds live credentials.** Never `cat`,
   `echo`, `grep`, print, log, copy, or paste any value from it, and never write
   a credential into a source file, a test, a fixture, or a document. Scripts
   read it through `node --env-file-if-exists=.env`; code reads it through
   `apps/api/src/env.ts` and nowhere else.
4. **Temporary files go in your own scratchpad directory, never `/tmp`.** Under
   this sandbox `curl -o /tmp/...` silently writes a zero-byte file, which is the
   worst failure mode there is.
5. **This build runs unattended.** Nobody is available to answer a question.
   Decide, log the decision, and keep going. Never stop to ask.
6. **`docs/PRD.md` and `docs/BUILD_PLAN.md` are read-only.** So is
   `DECISIONS.md` except for appending your own row.

---

## 1. One tree, disjoint file ownership

You may write **only** the exact paths your task lists under "YOU OWN". Nothing
else — not a typo fix, not a missing import in someone else's file, not a
`package.json` tweak. `docs/contracts/OWNERSHIP.json` maps every path in the
build to the single unit that owns it; `docs/contracts/UNITS.json` lists every
unit with its scope and dependencies. There are no git worktrees (8 GB RAM);
everyone shares one working tree, so an out-of-bounds write is a silent
corruption of another agent's unit.

## 2. Stub-first, frozen skeleton

Run 0 created every barrel, route registration, `App.tsx`, and a throwing stub
with its **final exported signature** for every module:

```ts
export function rollup(input: CanonicalSubmission): Rollup {
  throw new Error('NOT_IMPLEMENTED:E03');
}
```

Run 1 and later **replace bodies only**. You never create a file that does not
already exist unless your task explicitly lists it as a path you own. The tree
typechecks from the first checkpoint and must keep typechecking.

**Frozen files** (bodies and signatures both): every `package.json`, the
lockfile, every `tsconfig*.json`, every `types.ts`, every barrel (`index.ts`),
`apps/api/src/app.ts`, `apps/console/src/App.tsx`, `apps/api/src/db/schema.ts`,
the DTOs in `packages/contracts`, the vector specs in
`packages/engine/src/vectors/`, and `docs/contracts/INTERPRETATIONS.md`.

## 3. Need a frozen file changed?

Do not change it. Write `docs/contracts/requests/<your-unit-id>.md` with: the
file, the exact change, why your unit cannot proceed without it, and the local
workaround you used instead. Then **carry on with the local workaround** — a
narrow cast, a locally declared type, a `// TODO(contract):` comment. The human
applies additive changes at the next checkpoint. Never block on a request.

## 4. Commands you must never run

Never run any of:

- `npm install`, `npm ci`, `npm update`, or anything that writes the lockfile
- `git commit`, `git add`, `git checkout`, `git push`, `git merge`, `git reset`
- a repo-wide `tsc` / `tsc -b` / `npm run typecheck`
- a package-wide or repo-wide `vitest` / `npm test`
- `npm run verify`, `npm run verify:llm`, `npm run seed`
- any listening server (`npm run dev:api`, `npm run dev:console`, `expo start`)

The human runs all of those once, at the checkpoint. What you **may** run:

- `npx vitest run <your own test file> --project <name>` with
  `VITEST_MAX_WORKERS=1`
- once, at the end: `npx tsc --noEmit -p <your own package>`
- `npm view <pkg> version` (read-only version lookup)

## 5. No network by default

`vitest.setup.ts` replaces `fetch` with a guard that throws on any non-localhost
URL unless `RUN_LIVE=1`. Only `*.live.test.ts` files are allowed to make live
calls, they are excluded from the default run, and only the units that own a
live call may have one (F02 for the Federato snapshot; the Gemini call units,
each with one tiny input). Everyone else uses, in order of preference:
`packages/federato/fixtures/mini-snapshot.ts`, the real saved snapshot, and
`apps/api/src/llm/fake-provider.ts`. Never hit a third-party API from a normal
test.

## 6. Route tests are in-process

Never start a listening server to test a route. Use Hono's `app.request()`
against an in-memory SQLite database (`:memory:`) with an injected `Deps`
(`{ db, adapter, llm, clock }`). No `fetch` to `localhost:3000`, no ports.

## 7. No shared helpers invented

`docs/contracts/HELPERS.md` names every shared helper and where it lives:
`packages/engine/src/util/math.ts`, `packages/contracts/src/format.ts`,
`packages/engine/src/sweep/geometry.ts`. Use those. If you need something else,
keep it **private to your own file** — do not create a new `utils.ts`, do not
add to someone else's helper module, do not duplicate a helper that already
exists. Re-implementing arithmetic that `util/math.ts` already exports is a bug,
not a shortcut.

## 8. Decisions, and the 30-minute blocker rule

Anything the PRD or your task leaves genuinely open: **decide it**, write
`docs/decisions/<your-unit-id>.md` with the decision, the reason, and the
alternative you rejected, and continue. Never stop to ask.

If something blocks you for more than 30 minutes, stub it with a
`// TODO(blocked): <reason>` comment, append one JSON line to
`docs/status/blocked.jsonl` (`{"unit":"E07","file":"...","reason":"...","at":"<iso>"}`),
and move on to the rest of your unit. A partly finished unit that typechecks is
worth far more than a finished unit nobody can build on.

## 9. Structured output

End by returning the structured object your task asks for. Be exact — an auditor
checks it against the tree:

- **files written**: every repo-relative path you created or modified, and
  nothing you did not touch
- **test command + result**: the literal command you ran and what it printed
- **contract requests**: the ids of any `docs/contracts/requests/*.md` you wrote
- **open issues**: every `TODO(blocked)` you left, and anything you are unsure of

---

## House style

- TypeScript everywhere, ESM (`"type": "module"`), Node 24.
- `moduleResolution: "Bundler"` — import without a file extension
  (`import { rollup } from './rollup'`), never with `.js`.
- `erasableSyntaxOnly` is on: **no** `enum`, no parameter properties
  (`constructor(private x: number)`), no namespaces. Use `const` objects with
  `as const` and a derived union type.
- `verbatimModuleSyntax` is on: type-only imports must say
  `import type { Foo } from './types'`.
- No `any` in any exported signature. `unknown` plus a zod parse instead.
- Cross-package imports go through the barrel (`@retrofit/engine`), never a deep
  path into another package's `src/`.
- `packages/engine` is pure: no I/O, no `Date.now()`, no `Math.random()`, no
  network, no LLM SDK, no import from `apps/*`. A clock or a seed is passed in.
- No LLM decides a verdict, a score, or a dollar amount. Gemini turns prose into
  typed values and typed values into prose; the engine does the arithmetic.
- Every verdict names its deciding rule with document, section, and quote.
- No eslint, no prettier, no Tailwind, no dotenv, no drizzle-kit, no Python,
  no Docker, no pnpm.
