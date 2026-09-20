# Status

**Live:** console https://retrofit-gamma.vercel.app · API https://api-production-e7f5.up.railway.app (see DEPLOY.md)

Overnight unattended build, 2026-09-19. Branch `build/retrofit` (pushed; **not** merged to `main`).

## Needs you — in this order

1. **Gemini now matters only for the phone app's image analysis.** Every text AI call — reply extraction, request drafts, narration, schema-assist, the verification second opinion — runs on **Claude Sonnet 5** (DECISIONS L-1, L-2), live on Railway and verified end to end: a real broker reply became 4 typed fields with verbatim quotes, and the account re-scored. The Gemini key is still out of prepaid credits (HTTP 402), which blocks only the room-sweep vision (`observe`) and the fix-photo check (`verify-fix`). Top up at <https://ai.studio/projects> before demoing the phone app.
   - After that, run `npm run verify:llm` once to re-run the second opinion on Claude and, for the first time, measure reply-extraction accuracy (VERIFICATION.md). It costs real money on Sonnet 5; decide first.
2. **Run the phone app on a real iPhone.** No one has. It typechecks, its logic has 139 passing tests and `expo-doctor` passes 21/21, but no agent can drive a camera or compass. Start with the ten checks below.
3. **Rehearse the demo once, by hand.** Every API call and every console page has been exercised; a person has not yet clicked the full path. Follow `DEMO.md` from its pre-flight.
4. **Decide on `main`.** The work is on `build/retrofit`, pushed to the shared remote. `main` (your teammate's) is untouched. Merge when you're happy.
5. **Rotate both credential sets after the event.** The Federato client secret and the Gemini key were pasted into a chat transcript (PRD 17.4).
6. **Optional, never started — both need an account in your name:** register the `retro.fit` domain (GoDaddy Registry prize), and create a Sentry project for its DSN (Sentry prize). The Sentry hook is stubbed and wired (`apps/api/src/observability/`); it needs a DSN and about an hour.

## What's built

All four prize targets have working code. Phase 1 is complete and verified; phase 2 (the phone app) is built but not device-tested.

| PRD 15 definition of done | State | Evidence |
| --- | --- | --- |
| `npm test` passes, including 100K property + differential cases | **Met** | 1,805 / 1,805 tests, 143 files; `tsc -b` 0 errors |
| `npm run verify` completes 10 million with zero unexplained failures | **Met** | 10,000,000 of 10,000,000 — 0 invariant violations, 0 disagreements, 0 errors (46 min, 6 workers) |
| `npm run seed` against the live API stores all 158 with results and query traces | **Met** | 158 stored, 158 scored, 158 traced; live adapter, 4 queries in 9.2 s |
| Console shows the ranked queue and, per account, explanation, factor breakdown with citations, query trace, pricing, flip | **Met** | All 12 panels (a)–(l); every route renders in a real browser with 0 console errors |
| `VERIFICATION.md` with layer-C agreement and the disagreement list | **Met** | 1,331 / 1,332 (99.9%, 95% CI 99.6–100.0%); all 38 real accounts agree; the one disagreement explained |
| Action loop end to end on a seeded reply | **Met** | Integration test, and live: a real reply → 4/4 fields with quotes → rank 8 → 2 |
| Unsetting `FEDERATO_BASE_URL` switches to the snapshot | **Met** | `/health` → `adapter: mock`, loud banner, no code change |
| Phase 2: the full sweep flow on an iPhone in Expo Go | **Needs a human** | All screens built; not run on a device; vision blocked by the 402 |
| Invariants: deterministic; every verdict cites its deciding rule; no LLM decides a number | **Met** | Determinism across 10M; tenant deciding-rule gap closed (CP3-1); LLM guardrails pinned by integration tests |

## The numbers

- **Book:** 158 submissions — 1 FIT, 11 REFER, 146 DOES_NOT_FIT (120 knocked out at triage on line of business). #1 is SUB-2026-00081, Coastal Freight Systems LLC: FIT, 88/100.
- **Verification:** layers A + B 10M / 0 / 0; layer C 1,331 of 1,332. Full account in `VERIFICATION.md`.
- **Testing found real bugs, which is the point:** the first differential run reported 20,662 invariant violations and 1,369 disagreements (a hole in our own interpretation contract, and a peer-distance overflow). A review over the *real* Federato data then found 39 confirmed defects — the worst was every building being assigned the first location's id, which put the state wrong on 11 of 27 accounts, and a date conflict that left the real book with **zero** FIT accounts. All fixed and pinned by tests.

## Cut, blocked, or honestly limited

| Item | Why |
| --- | --- |
| **Reply-extraction accuracy: not measured** | It ran after the Gemini credits ran out, so every call failed; the 41% it produced was discarded. Extraction now runs on Claude Sonnet 5 and works live (4 fields from one reply: 3 accepted, 1 hedged value sent to confirm), but the 30-reply accuracy check has not been re-run. |
| **706 layer-C cases unanswered** | Same 402. Resumes from cache after a top-up. |
| **No real account has a minimal flip** | 23 of 26 declined accounts fail on something the insured can't change (building age, state, renewal); the other 3 fail only on premium but need more than the two-move cap. The engine states the reason, which is what the demo shows. |
| **Enrichment is display-only** | Flood zone and fire-station distance are fetched and shown but feed no score or price. Overpass was also mostly down (2 of 27). |
| **3D coverage dome cut** | Its libraries were never installed and nobody could verify a 3D render in Expo Go. The 2D Skia ring ships instead (the PRD's named fallback). |
| **schema-assist not enabled in ingest** | The synonym table and graph search already place every needed field on this dataset. |
| **Sentry, domain** | Need accounts in your name. |

## iPhone — first ten checks

Set `EXPO_PUBLIC_API_URL=https://api-production-e7f5.up.railway.app` (works on any network, so there's no need to run the API locally), then `npm run dev:mobile` and open in Expo Go.

1. **It launches.** The rooms list shows, with a "New sweep" button. (The native modules were realigned to Expo Go's SDK 57 versions overnight; if anything crashes on launch, that is the first suspect.)
2. **New room:** label, term (4/8/12 months), and two equal choices — scan with the camera, or upload 3 photos.
3. **Permissions:** deny camera, then location — each explains itself in plain words and offers the photo path; nothing crashes.
4. **Sweep:** turn slowly. One haptic tick about every 1–2 s, never two within a second; the ring fills as you turn; it stops capturing at 15 frames but keeps filling.
5. **Wrap-around:** start facing roughly north and turn right through 0°. Coverage only goes up; the ring never jumps.
6. **Finish:** disabled until ~75% (about 270° of turning), with a spoken reason.
7. **Turn hint:** "turn left/right about N°" points the physical way (right = clockwise).
8. **VoiceOver on:** every control is announced with a name and role; the ring reads as text ("62 percent scanned…").
9. **Analyzing:** stages advance from the real API, not a timer. (The vision step still needs Gemini credits — without them this is where it fails.)
10. **Offline:** capture, enable Airplane Mode, tap Finish → "Queued"; turn it off → it sends.

All 96 checks written by the mobile units: `docs/status/iphone-checklist.md`.

## Where to read more

- `DEMO.md` — the live script, with pre-flight and fallbacks.
- `VERIFICATION.md` — every verification number, and what each can and cannot prove.
- `DECISIONS.md` — every call made overnight and why, with the alternative rejected.
- `docs/status/smoke.md` — the live end-to-end run.
- `docs/reviews/` — the six Run 2 reviews, including 16 logged minor findings not fixed.
