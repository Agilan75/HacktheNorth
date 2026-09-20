# TOUR — `/tour`, the 3D walkthrough landing page

## Decision

`/tour` is the presentation: a 3D story followed by a collapsible dossier.

**The story** is a standalone marketing surface: one procedural three.js apartment as
a fixed background, and scroll scrubbed directly onto a camera rail through it.
Each object the camera passes gets a tag that tracks it in screen space —
`portable_heater`, `curtain`, `bedding`, the empty `smoke_detector` mount, the
verdict, the re-priced fix — in the order the real pipeline runs them.

**The dossier** is everything past the last beat. The canvas fades out (the page
takes a `rf-tour--parked` class) and the sections render on opaque paper,
because weight tables over a moving 3D background are unreadable. Every panel is
a native `<details>`, collapsed by default, with an Open all / Close all pair per
section and a sticky chip index above them:

- **Architecture** — the purity rule, how data moves, the six engine stages, the
  eight workspaces, the stack.
- **The rulebook, with its weights** — read live from `GET /rules` on every load.
- **The Federato agent** — the six planner steps, including the `$elemMatch`
  rewrite and the declined `over`.
- **Testing, and what we did not prove** — live counts from `GET /verification`,
  then the honest limits list.

Files: `apps/console/src/pages/TourPage.tsx`, `apps/console/src/pages/tour-house.ts`,
`apps/console/src/pages/tour-dossier.tsx`, `apps/console/src/pages/tour-rules.tsx`,
`apps/console/src/styles/tour.css`, `apps/console/src/pages/TourPage.test.tsx`.

## The rulebook is read, not typed

`client.getRules()` types `rulebooks` as `unknown[]` and drops the response's
top-level `weights` record, so `tour-rules.tsx` narrows the shape itself: its own
`toRule` / `toRulebooks` guards (malformed rules are dropped, not rendered), its
own `buildMatrix`, and `toWeights` to recover the weights record off the raw
object. A factor's weight is the declared one, falling back to the single weight
its own rules agree on. It does **not** import from `RulesPage` — that file
belongs to another unit, and this is a different reading of the same endpoint.

The three rulebooks are kept apart on purpose, since only one of them scores a
Federato account: `commercial` (the eight weighted factors, 100% of the score),
`tenant` (what the phone app runs — prices a room, never an account) and
`extensions` (ours, feeding the rating table, never the appetite score).

## Why

The phone app already labels and prices objects as the camera passes them. The
website explained that in prose. This makes the website do it.

## Frozen files touched, and why not a contract request

Two additive edits, applied directly rather than filed under
`docs/contracts/requests/`, because the parallel build is over and the human is
the only agent in the tree:

- `apps/console/src/routes.ts` — one new key, `tour: '/tour'`. No existing path
  changed. Deliberately **not** in `NAV_ITEMS`: it is not a console route.
- `apps/console/src/App.tsx` — the existing route table moved into a
  `ConsoleShell` component, and `App` now routes `/tour` *outside* `Layout`, so
  the page is full-bleed with no header, nav or adapter banner. Every console
  route still renders inside `Layout` with the banner, exactly as PRD §10
  requires; `App.test.tsx` asserts both halves.

`apps/console/src/pages/HomePage.tsx` gains one hero CTA, "Walk the room". It
stays out of the homepage rail, which is by its own test the five *console*
pages.

## Alternatives rejected

- **The whole console in the house** (nav moves the camera between rooms):
  route-level camera state and a persistent canvas under every data table, for
  no gain on pages that are tables.
- **Free look / WASD:** a page that has to communicate copy cannot also ask the
  visitor to drive.
- **Autoplaying sweep:** no deep links, no user control, worse under
  `prefers-reduced-motion`.

## Notes

- The 3D is background only. The canvas is `aria-hidden`, every word lives in a
  real `<section>`, and with no WebGL the page is a plain scrolling document —
  which is exactly what the jsdom tests exercise.
- Reduced motion drops the easing (scroll still moves the camera; that is direct
  manipulation, not animation) and the tag layer is hidden under 47rem.
- The numbers on the tags are illustrative and the price is labelled
  "estimate, illustrative" — tenant rates are invented (README).
- `COLORS.blueTint` is inlined as a literal in `tour-house.ts`: the published
  `@retrofit/design` types predate the accent family and do not typecheck from
  the console. Marked `TODO(contract)`.

## The rulebook section is a guideline table, not a panel stack (2026-09-20)

`/tour`'s rulebook section was a stack of collapsible factor panels: one panel
per factor, each holding a flat list of its rules. It is now the same ruled
sheet the console's `/rules` page draws — one row per factor, one column per
tier (Target · Acceptable · Refer · Not acceptable, each with what it is worth),
the plain-English criterion in the cell with its rule id on a manila tab, the
weight as a value plus a bar, and the interpretations as red-pen notes in the
ledger's double-ruled margin. Opening a criterion unfolds the rule under its own
row: citation, the raw condition the engine tests, weight, interpretation, fix.

**Why:** the whole point of an appetite guideline is the comparison across a
row — Target against Not acceptable on the same factor. A panel stack hides
exactly that behind eight clicks.

**Rejected:** importing the console's `RulesPage` matrix. It exports none of its
internals, `/rules` owns that file, and the tour reads the same endpoint with
its own labels. The condition-phrasing helpers are duplicated privately here
rather than promoted into a shared module (AGENTS §7).

**Motion:** an IntersectionObserver adds `rf-reveal`/`is-in`, and only when the
reader has not asked for reduced motion — so no-JS and reduced-motion readers
get the table with no hidden states at all. The sheet fades up, the tier rules
draw left to right, rows settle 36ms apart (capped at eight), the weight bars
fill after their row lands, criterion tabs lift 1px on hover, and an opened rule
unfolds with a clip-path wipe rather than appearing.
