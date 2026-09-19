# Decisions — mobile rework (`feat/ar-sweep`)

Branched from `build/retrofit`. One commit per phase, in order. Everything the task,
the PRD or `AGENTS.md` left open, decided here with the alternative rejected.

---

## C0 — dependency compatibility, checked before writing any AR code

**Result in one line:** `@reactvision/react-viro@2.58.1` is version-compatible with
`expo@57.0.24` / `react-native@0.86.3` / React 19 and requires the New Architecture, which Expo 57
already is — no patch needed — but it is a native module that **cannot load in Expo Go**, so the
Viro path is a development build only and the gyro path stays the Expo Go path.

Checked against the npm registry and the published package contents, plus the Expo SDK 57 docs.

| Claim | Evidence |
| --- | --- |
| Peers accept this stack | `peerDependencies` = `expo >=55.0.0 <58.0.0`, `react-native >=0.83.0 <0.87.0`, `react >=18.0.0`; `engines.react-native` the same range. All three pins fall inside. |
| Developed against this exact stack | Its own `devDependencies` are `expo ~57.0.0`, `react-native ~0.86.0`, `react ~19.2.3`, `@expo/config-plugins ~57.0.0`. |
| New Architecture | Required, not optional. npm `description`: "Maintained version of react-viro - New Architecture (Fabric) required". `dist/plugins/withViro.js`: "ViroReact 2.43.1+ only supports New Architecture." Expo 57 is New-Arch-only, so this is satisfied. |
| Not in Expo Go | Native, 85.8 MB unpacked over 1,268 files, ships an Expo config plugin at `app.plugin.js`. ReactVision's docs: "ViroReact does NOT work with Expo Go. You must use a development client or `expo prebuild`." |
| Config plugin | `"@reactvision/react-viro"` (the package's `app.plugin.js` re-exports `dist/plugins/withViro`). |

**Two traps found and avoided.**

1. The bare npm package named `viro` is **not** ViroReact. It is an abandoned 2018 name-squat:
   one version, a 264-byte tarball holding a 200-byte `package.json` and a 0-byte `index.js`.
   Only `@reactvision/react-viro` is the real library.
2. `withViro`'s `provider` option defaults to `"reactvision"`, which then demands `rvApiKey` and
   `rvProjectId`. We set `"provider": "none"` so the build needs no account and no key —
   plane detection and world tracking are ARCore/ARKit features and need neither.

**Two more compatibility answers from the same check, both decisive for C1:**

- **Skia is in Expo Go for SDK 57, at exactly the pinned 2.6.2.** Confirmed three ways: the SDK 57
  doc page carries the "Included in Expo Go" badge, the library sits under the docs' "Third-party
  libraries supported in Expo Go" heading, and `apps/expo-go/package.json` on expo/expo's `sdk-57`
  branch — the source the Expo Go binary is built from — lists `"@shopify/react-native-skia":
  "2.6.2"`. Negative control: the SDK 57 `expo-maps` page has no such badge. So `CoverageWash`,
  `HazardPin` and `ValueTag` may be drawn with Skia and still run in Expo Go with no dev build.
  **Do not upgrade Skia to the registry's `latest` (2.12.0)** — only 2.6.2 is compiled into the
  Expo Go SDK 57 binary.
- **`expo-sensors` `DeviceMotion` is in Expo Go on both platforms** and exposes
  `rotation.{alpha,beta,gamma}` in radians. Android sign-normalises them (`alpha = -azimuth`,
  `beta = -pitch`) so `rotation` must **not** be branched on platform; `rotationRate`, by contrast,
  maps axes differently per platform (iOS `alpha=z,beta=y,gamma=x`; Android `alpha=x,beta=y,gamma=z`),
  so `pose.gyro.ts` uses `rotation` deltas and never `rotationRate`. `alpha`'s absolute frame
  differs per platform (iOS `CMAttitude` can silently fall back to an arbitrary reference), which is
  why absolute yaw is corrected from `expo-location` `watchHeadingAsync` rather than taken from
  `alpha` directly.

---

## Environment

| # | Decision | Why | Rejected |
| --- | --- | --- | --- |
| ENV-1 | **Node 24.19.0 installed via `winget install OpenJS.NodeJS.LTS`.** | No Node, npm, `node.exe`, PATH entry or registry entry existed on this machine, although `node_modules` was fully populated. Without it nothing in the definition of done is verifiable: no `npm install`, no `typecheck`, no vitest, no `expo-doctor`, no device run. | Committing six phases unverified. The user chose the install. |
| ENV-2 | **Three engine/API tests fail on Windows and are left alone.** `data.test.ts` "resolves data beside src/" expects `/` separators; `fixtures/golden.test.ts` "byte-for-byte" expects LF and git checks out CRLF; `scripts/backfill.test.ts` reads the gitignored `apps/api/data/backfill`. | All three fail identically on `build/retrofit` with this branch stashed — verified. They are environment artefacts, not regressions, and all three sit in files this task may not touch. | Fixing them, which would mean editing frozen files for a problem this task did not create. |

---

## Overrides of `AGENTS.md` and the PRD

| # | Rule overridden | What was done, and on whose authority |
| --- | --- | --- |
| OV-1 | `AGENTS.md` §4: never run `npm install`, a repo-wide `tsc`, or a package-wide `vitest`. | The task's rule 9 authorises one `npm install`, and rule 5 requires `npm run typecheck -w @retrofit/mobile` plus the mobile vitest files on every commit. Package-scoped `tsc -b apps/api` and `--project api` vitest runs were also used to verify the API changes this task asks for. Recorded here; nothing else in §4 was run. |
| OV-2 | `AGENTS.md` §2: `packages/contracts` DTOs are frozen. | The task's rule 3 explicitly authorises DTO changes "in the same commit" as the zod schema. See A-5 and A-6 below. |
| OV-3 | `packages/design/src/tokens.ts` is marked FROZEN (W0-4). | The task's rule 4 explicitly authorises changing it and requires the FROZEN comment be updated to record that. |
| OV-4 | PRD §11's route table (`/`, `/new`, `/sweep`, `/confirm`, `/questions`, …) and the 14-question VOI loop. | The task replaces both. PRD §11 is read-only, so the deviation is recorded here rather than edited into it. |
| OV-5 | PRD §9.3 step 7: "Observations under 0.6 go back to the user to confirm or dismiss before the engine runs." | Phase B deletes `/confirm`, so nothing can confirm them. See A-2. |

---

## Phase A — questions go to zero

| # | Decision | Why | Rejected alternative |
| --- | --- | --- | --- |
| A-1 | **`observable` is a property of `questions/tenant.json`, read by the API straight from the file** (`readObservableQuestionIds` in `services/sweep.ts`), not a new field on the engine's `Question` type. | `packages/engine/src/**` is off-limits (task rule 1), and the engine's `questionSchema` strips unknown keys, so the flag would never survive `readQuestions`. One `readFile` through the engine's own exported `dataFilePath` keeps the frozen type and the frozen schema untouched. | Widening `Question` and `questionSchema` — forbidden. Duplicating the observable/not-observable split as a hard-coded list in the API — it would drift from the data file. |
| A-2 | **A sighting under `MIN_OBSERVATION_CONFIDENCE` is now scored at its own low confidence instead of being held out of the hazard assessment.** The `heldOpen` set and its `LABEL_TO_KEYS` table are deleted. | With `/confirm` gone (Phase B) nothing can confirm a pending sighting. Holding its slot open and then filling the gap with `false` (A-3) would turn a 0.45-confidence candle into "no candle" — strictly worse than either alternative. The engine already carries and discounts per-value confidence, which is exactly the mechanism for "we think we saw this, not very sure". `needsConfirmation` is still reported on the DTO; it just no longer holds the sweep at the `questions` stage. | Keeping `heldOpen`: silently discards real evidence. Keeping `/confirm`: the task deletes it. |
| A-3 | **Unwritten observable fields are filled with `false` (or `0`) at confidence = the covered fraction of the sweep**, via the engine's own `unknownHazards`, falling back to the engine's `SWEEP_FALLBACK_CONFIDENCE` (0.5) when coverage is 0. | The task forbids inventing a confidence scheme. The covered fraction is precisely what `sweep/observations.ts` `assess` already uses for its own negative evidence, so a filled gap and an engine-recorded absence carry the same number. Using `unknownHazards` rather than a local list means the two can never disagree about which slots are unknown. | A fixed constant — a new scheme. `MIN_OBSERVATION_CONFIDENCE` — a threshold, not a measurement. |
| A-4 | **`exposure.contentsLimit` prefers the estimate the phone priced during the sweep**, carried to the server as `contentsEstimateUsd` and persisted as a derived observation with the value in its id (`contents:21300`). The fallback is the table price of the belongings the sweep itself saw. Either way: rounded up to the nearest $5,000, floor $15,000, `source: 'sweep'`. | The HUD shows a running replacement value during the sweep; a verdict whose contents figure ignored it would contradict the screen the renter just watched. The `sweeps` table has no column for it and `db/schema.ts` is frozen, so the value rides on a derived observation — the same id-encoding convention this unit already uses for `relate:<key>:<presence>:<ids>` and `ceiling:f<N>`. `runObserve` replaces the observation list, so the marker is explicitly carried across it. | A new DB column (schema frozen). Deriving from sweep observations only: the hazard vocabulary is 21 labels and has no jewellery price, so almost every room would land on the $15,000 floor. |
| A-5 | **`SweepCreateRequestDto.roomLabel` and `.termMonths` become optional**, defaulting server-side to `Room` and 12 months. | Phase B deletes `/new`, so nothing collects either before the camera opens. A required field no screen can fill is a broken contract, not a safety net. Task rule A-4 sets the term default at 12. | Making the phone invent a label client-side — pushes a server default into two places. |
| A-6 | **Inline corrections travel as `edits` (field-addressed), not as answers (question-addressed).** | `submitAnswers` maps `questionId → field`, and a derived field has no question — `q-contents-limit` is deleted. An edit names the vector component directly, is coerced against that component's type in code, and is stored as the component's `source` path so `merge` sees one spelling. It is not counted as a question asked, so correcting a number never uses up the single question allowed. | Keeping `q-contents-limit` and marking it observable: the task says delete it outright. Overloading an answer with an unknown `questionId`: implicit and untyped. |
| A-7 | **`min`/`max` on a vector component are not used to validate an edit.** | They are the min-max *scaling* bounds. `smokeDetectorCount` maxes at 4 for scaling, and a fifth detector is still a true answer. Edits are checked for finiteness and non-negativity, and the year for a four-digit range. | Validating against them: would reject true answers. |
| A-8 | **"VOI exceeds the existing threshold in `voi.ts`" is read as membership in `voi.ranked`.** | `voi.ts` has no numeric threshold constant. Its gate is `expectedScoreSwing === 0 && undeterminedRuleIds.length === 0 → skip`, so a candidate reaches `ranked` only when it can move the appetite score or leaves a rule undetermined. `qualifyingQuestion` walks `ranked` in order and takes the first non-observable entry. | Inventing a numeric threshold — the task forbids a new scheme and there is nothing to compare against. |
| A-9 | **Two `packages/engine/src/rules.tenant.test.ts` cases fail on this branch and are not fixed here.** | Deleting `q-contents-limit` breaks a 1:1 question-per-component assertion and a contents-options assertion, both inside the off-limits engine package. Filed as `docs/contracts/requests/mobile-rework.md` with the exact replacement code, per `AGENTS.md` §3, and logged to `docs/status/blocked.jsonl`. | Editing the frozen test. Keeping the question, which the task forbids. |
| A-10 | **`capture.ts` keeps its 15-frame cap.** | The task's C1 note says "cap 20 frames — this is already in `capture.ts`. Keep it"; the file actually caps at 15, which matches the engine's `MAX_FRAMES`, the contracts schema's `.max(15)` and PRD §9.2's "up to 15 quality-passed frames" for the `observe` call. Raising it to 20 would send more frames than the Gemini call contract permits and would need an engine change, which is off-limits. Confirmed with the user. | Raising the cap to 20. |
