# Contract request — mobile home flow

**File:** `docs/contracts/OWNERSHIP.json` (and `UNITS.json` if the unit's `owns` list mirrors it).

**Change (additive):** map `apps/mobile/app/scan.tsx` and `apps/mobile/src/lib/rooms.ts` (plus its
test) to unit **M6**, and retire the four entries that name files deleted in commit `a3ed8a3` —
`apps/mobile/app/new.tsx` (M5), `apps/mobile/app/sweep.tsx` (M6), `apps/mobile/app/confirm.tsx`
(M7), `apps/mobile/app/questions.tsx` (M7).

**On `src/lib/rooms.ts` and AGENTS.md §7.** §7 forbids inventing shared helpers. This is not a
helper module: it is a store, a peer of `src/lib/session.ts` and `src/lib/queue.ts`, and it
duplicates nothing that already exists. It was necessary rather than convenient — deriving the
rooms list from the session store forced an offline-queued sweep to write its id into the *live*
session to get itself listed, which re-pointed a running scan at the wrong sweep (the second room's
camera showing the first room's hazard pins). Splitting "rooms already sent" from "the room being
scanned" is what fixes that class of bug, and it is recorded in
`docs/decisions/mobile-home-flow.md` §H13.

**Why:** the camera and the sweep moved out of `apps/mobile/app/index.tsx` into a route of its own
so that `/` could become the app's opening screen. `index.tsx` keeps its M5 mapping and is now
home; the ~700 lines of capture, pose and permission logic that M6 is really about now live at
`scan.tsx`, which the map does not mention. The map meanwhile still lists four paths that have not
existed since `a3ed8a3`, so today it points M6 at a deleted `sweep.tsx` and at nothing for the file
that replaced it.

`app/_layout.tsx` (W0-4) was also edited — a route registration, the `unstable_settings` anchor,
and the `ErrorBoundary` button's target. It is **not** on the AGENTS.md §2 freeze list, so no
request is needed for that edit; it is named here only so the cross-unit reach of this change is
on the record. `analyzing.tsx` (M6), `verdict.tsx` (M8), `hazard/[id].tsx` and `s/[slug].tsx` (M9)
each had their navigation targets retargeted and are all already mapped.

**Workaround in place:** none is needed and nothing is blocked — the route works, and
`npx tsc --noEmit -p apps/mobile` passes. The only cost of leaving the map as it is: the next agent
to be handed "unit M6" gets a path list naming a file that does not exist and missing the one that
does.

**Alternative considered and rejected:** naming the route `/sweep` instead of `/scan`, which would
have landed on the already-mapped path and needed no request at all. Rejected because every button
in the product says "Scan" and that is the word the change was asked for in. Recorded in
`docs/decisions/mobile-home-flow.md` §H10.

**Also stale, owned by nobody in this change** (noted rather than drive-by edited):

- `src/lib/session.ts:6` — "shared by `/new`, `/sweep`, `/analyzing`". Those two routes are gone;
  it is now home, `/scan` and `/analyzing`.
- `src/lib/session.ts:83-86` — "the viewfinder is the first screen, so nothing asks for one and the
  server defaults it". Home asks for one now. This comment is the most misleading of the three.
- `src/lib/capture.ts:2` — "The `/sweep` capture loop".
- `src/ar/ViroSession.tsx:7` — "nothing else in the app knows this file exists except
  `app/index.tsx`". It is `app/scan.tsx` now.
