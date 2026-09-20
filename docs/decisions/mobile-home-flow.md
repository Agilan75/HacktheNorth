# Decisions — the opening screen (`/` becomes home, the camera becomes `/scan`)

The app opened straight into the camera: launch, and you were already sweeping. This adds an
opening screen, so the app takes you home first and you start a quote for a named room from there.

`app/index.tsx` was moved to `app/scan.tsx` unchanged apart from the additions listed below, and a
new `app/index.tsx` was written as home. Every path in the tree still resolves, because `/` kept
its name.

---

## H1 — two routes, not three

**Decision.** Home is both the landing page and the new-quote form. There is no intermediate
`/new`.

The flow before commit `a3ed8a3` was `/` (your rooms) → `/new` (name, term, pick a path) →
`/sweep`. Restoring all three would have been the most faithful reconstruction, and it is what one
of the three designs proposed. It was rejected on the user's own framing: a very simple change,
done quickly. Three screens is two taps to a camera and a whole route to maintain; folding the
form into home is one tap and no new route beyond the camera's.

**Rejected:** restoring `/new`. **Also rejected:** no form at all (home as a pure landing page with
one button) — that leaves `roomLabel` and `termMonths` orphaned, which is the bug below.

## H2 — the room is named again

**Decision.** Home writes `roomLabel` and `termMonths` into the session before pushing `/scan`.

`SessionState` has carried both fields since the beginning, and since the viewfinder became the
launch route nothing set either of them. `buildCreateRequest` fell through to `DEFAULT_ROOM_LABEL`
on every single sweep, which is what commit `6a2e94e` ("always name the room") had to paper over
at the transport layer. Now a room is named because somebody named it.

The name is **optional**. An empty field still sends `'Room'`, exactly as before, so nothing is
gated behind typing.

## H3 — `dismissTo('/')`, never `replace('/')`

**Decision.** Every edge that means "go home" uses `router.dismissTo('/')`. Every edge whose button
says "Scan" uses `router.replace('/scan')`.

This is the one non-obvious mechanical consequence of the change, and a typechecker cannot catch
it: `app.json` sets `experiments.typedRoutes: false`, so every route is an unchecked string.

With home permanently at the bottom of the stack, `replace` swaps only the top frame:
`[index, verdict]` → `replace('/')` → `[index, index]`. Two mounted home screens, two queue
subscriptions, two `AppState` listeners, and a back gesture that appears to do nothing.
`dismissTo` pops to the target when it is in the stack and replaces the current screen when it is
not, so it is correct from any depth and on a cold deep link
(`node_modules/expo-router/build/global-state/router.d.ts:8,66`).

**Acceptance check:** `grep -rn "router.replace('/')" apps/mobile/app` must return nothing.

## H4 — "Scan another room" goes home, not to the camera

**Decision.** `verdict.tsx`'s `onScanAgain` calls `dismissTo('/')` even though its label says scan.

It looks like an inconsistency and will invite a "fix". It is not: `sessionStore.reset()` runs
immediately before it, wiping `roomLabel` and `termMonths`, and home is the only screen that sets
them. Sending it to `/scan` would send the next sweep unnamed — the exact bug H2 exists to close.
The reasoning is repeated as a comment at the call site.

## H5 — `headerBackVisible: false` dropped from `/analyzing` and `/verdict`

**Decision.** Both routes get their native back button back.

The flag was correct when the camera was the root: there was nothing behind those screens worth
returning to. Home is behind them now, so the flag is pure cost — it suppresses a free, correctly
sized, correctly labelled 44pt exit and was the direct cause of three dead ends, the worst being
`/verdict` with `result === null` and a non-failed stage, whose only control is "Check again"
(which merely refetches). That state also gets an explicit "Back to your rooms" button.

Leaving `/analyzing` mid-poll is safe: its effect aborts the controller on unmount and guards the
resolve behind `signal.aborted`, so a late reply cannot yank someone off home.

## H6 — the camera needs a visible way out

**Decision.** A filled 44pt close chip, pinned top right over the viewfinder, plus a quiet "Back"
on each of the five states that replace it (checking, camera-denied, compass, queued, not-sent).

`/scan` is registered `headerShown: false`, so there is no system back button and the gesture is
invisible. Without these it is the worst dead end in the app: a full-screen camera with no exit,
in six separate states. A bone text link beside "Upload photos instead" was rejected — it sits on
an arbitrary camera image with no scrim and is an easy mis-tap. Top right because the HUD owns the
top left with the coverage chip.

Leaving the queued state is safe: the queue keeps sending in the background and the sweep
registers itself on home when it lands.

## H7 — the rooms list is this launch only

**Decision.** Home lists the rooms sent since launch, from a module-scope registry fed by
`sessionStore.subscribe`, and says so on screen.

There is no list-sweeps endpoint — `packages/contracts` has `createSweep` and `getSweep` and
nothing else — and nothing in `apps/mobile` persists anything. So a registry is the only option,
and "Rooms are kept until you close the app." is on screen rather than implied.

Each card loads its own sweep from `GET /sweeps/:id` and shows the stage and the verdict the API
returned. **No card shows a price.** `money()` is private to `verdict.tsx` and duplicating it here
would be a second source of truth for a dollar figure (AGENTS.md §7).

## H8 — `reset()` before every scan

**Decision.** `startQuote()` resets the session before writing the new room's name and term.

Without it the previous room's `sweepId` survives, and the viewfinder reads that id on mount to
decide whether hazard pins are tappable — so room 1's findings would anchor to room 2's walls.
Recording the room in the registry still works, because setting the id is what fires
`recordFromSession`, and it captures `source` before the camera clears the frames.

**Rejected:** keeping the id so the pins stay live. Pins from another room are a bug, not a
feature.

## H9 — the typed name survives backing out

**Decision.** `startQuote()` does not clear the room-name field.

Backing out of the camera is common — a denied permission, the wrong room, second thoughts.
Clearing the field on the way in would empty the input while the store still held the label, which
is a visible inconsistency every time. The alternative risk (a sweep labelled "Kitchen" that is
actually the bedroom) does not arise, because `startQuote` always resets and rewrites the label
from the field's current value.

## H10 — `/scan`, not `/sweep`

**Decision.** The camera route is `/scan`.

`/sweep` was the stronger engineering argument: `docs/contracts/OWNERSHIP.json:143` already maps
`apps/mobile/app/sweep.tsx` to unit M6, so it would create no unmapped path, and it would make two
stale doc comments true again (`src/lib/session.ts:6`, `src/lib/capture.ts:2`).

It was rejected on language. Every button in the app says "Scan", the screen is called the scan,
and that is the word the request used. A route name that disagrees with every label in the product
costs more than a line in a contract file.

**Consequence, recorded rather than hidden:** `apps/mobile/app/scan.tsx` is not in
`OWNERSHIP.json`, which still lists the deleted `new.tsx`, `sweep.tsx`, `confirm.tsx` and
`questions.tsx`. Per AGENTS.md §1 that map wants updating; per §3 this does not block.

## H11 — fixed in passing, because the file was moving anyway

Two pre-existing bugs, neither introduced here:

- **All six `<Screen>`s in the camera file had no `edges` prop.** The route is
  `headerShown: false`, so "Camera off", "No compass", "No connection" and "Not sent" all painted
  under the notch. Each now gets `edges={['top', 'bottom', 'left', 'right']}`.
- **`styles.overlay` was dead.** Defined, referenced nowhere. Removed.

`anchor: 'index'` was added to `unstable_settings` so a cold `retrofit://verdict` or
`retrofit://s/<slug>` opens with home underneath rather than a one-frame stack. It is belt and
braces — `dismissTo` already replaces when the target is absent — so if the unstable API ever
misbehaves, delete it rather than debug it.

## H12 — what this costs

One extra tap from launch to a sweep being sent (two in total, accepting both defaults).

What it buys: the room is named; the OS permission dialog moves off the cold-launch path to after
the user asked to scan; the camera and the 60 Hz motion listener no longer start at launch; a
queued sweep has a screen that outlives the camera and can flush it; and Android hardware back
stops exiting the app from a quote.

One cost worth naming: `/scan` now paints its "Opening the camera" spinner for an async tick on
every push, where on cold launch that tick used to hide behind the splash screen. Home warms the
compass permission read to shorten it. It deliberately does **not** warm the camera permission —
requesting that is what raises the OS dialog, and keeping it off the launch path is half the point.

## H13 — the rooms list is its own store, not a view of the session

**Decision.** `src/lib/rooms.ts` holds the rooms already sent. The session store holds the room
being scanned right now. They are separate, and the sweep records itself into the former.

The first cut derived the list from the session: home subscribed to `sessionStore` and recorded a
room whenever `sweepId` went non-null. That forced the offline-queued path in `scan.tsx` to write
its id into the **live** session to get itself listed, on a promise nothing cancels, outside the
`alive.current` guard. An adversarial review confirmed the consequence: finish a room offline, go
home, start a second room, and when the network returns the first sweep's id lands in the shared
session — which `/scan` subscribes to live — so the second room's camera shows the *first* room's
hazard pins, and the first room gets listed under the second room's name and term.

The two things were only ever conflated because the app could have one room in flight at a time.
A sweep now records `{ sweepId, roomLabel, termMonths, source }` captured **before** the await, so
it lists itself correctly however late it lands, and `setSweepId` is properly guarded — the session
is re-pointed only while the camera is still the screen on top.

This also removes the module-scope `sessionStore.subscribe` that was never unsubscribed, and gives
the registry real tests (`src/lib/rooms.test.ts`, 11 cases, including the late-sweep case above),
which a registry living inside a route file could never have had.

**Rejected:** guarding `setSweepId` alone — correct, but the queued room then never appears on home
at all. **Also rejected:** keeping the registry in `app/index.tsx` and importing it from
`app/scan.tsx` — a route file exporting a non-component API, untestable under vitest.

## H14 — room cards never fetch the photos

**Decision.** Home's `getSweep` passes `{ images: false }`.

A card draws a heading, a stage, a verdict pill and two lines of text. It draws no image. Without
the flag it pulled every kept frame as a `data:image/jpeg;base64,…` string — about six megabytes a
room — and parked the whole `SweepDto` in React state on the one screen that is never unmounted,
re-fetching on every focus. That is the same cost `scan.tsx` calls `clearFrames()` to avoid, three
lines away.

Every other non-drawing reader already passed it (`verdict.tsx`, and the poller in `api.ts`). The
two that omit it — `hazard/[id].tsx` and `verify-fix.tsx` — both actually render a frame. Home was
the only non-drawing reader that omitted it.

---

## Verification

`npx tsc --noEmit -p apps/mobile` — exit 0, all eight route files in the program.

`npx vitest run apps/mobile/src/lib/rooms.test.ts --project mobile` — 11 passed.

`vitest.config.ts` includes only `apps/mobile/src/**/*.test.ts(x)`, so the route files themselves
are covered by `tsc` and a device only. The rest is a device walk: all nine retargeted edges, both
permission-denied gates, a second room end to end, a cold `retrofit://s/<slug>` link, and — for
H13 specifically — finish a room in airplane mode, go home, start a second room, then restore the
network and confirm the second room's camera shows no pins from the first.
