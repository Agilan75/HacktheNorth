# TOUR-AGENT — the schema graph beside the six planner steps

The `#agent` section of `/tour` was six collapsed panels of prose describing
the strongest technical claim on the page: the planner builds its queries from
the live schema rather than from a fixed script. It read as the least
interesting section and was the most interesting thing built. This adds a
three.js scene of the Federato resource graph, pinned beside the panels, that
advances as each step is opened.

## Decisions

**Ink on paper, not a dark constellation.** The obvious treatment for a node
graph is glowing marks on black. Rejected: the console's language is warm paper
(`--rf-paper`), hairline rules, serif display, and `--rf-shadow-none` on
everything. A dark panel would have read as a widget imported from a different
product. The scene is unlit `LineBasicMaterial` hairlines and flat billboarded
discs — a WebGL line is exactly one pixel at any DPR, which is both the
drafting-table look and the cheapest thing to draw.

**Red marks the path taken, never a failure.** PRD §13 reserves red from
meaning "bad". So the red overlay is the route the planner *chose*; sage dashes
are roads not taken (rejected alternatives, the probe that misses, knocked-out
rows). Step 5 — the zero-result adaptation — therefore fails by *absence*: the
pulse travels out along the dot-path, fades, and arrives nowhere, then the
rewritten clause completes the same walk. Nothing turns red to signal an error.
Alternative rejected: red for the failed query, which would have been legible
but would have broken the rule everywhere else on the page.

**Authored geometry, transcribed numbers.** The layout is hand-placed and
fixed — a force simulation would look novel and be non-deterministic, and this
is a presentation surface that must look identical every run. But every path,
count, label and duration in `tour-agent-graph.ts` is transcribed from the
recorded ingest run rather than invented: `pathChosen.path`
(`exposure_units → location → buildings`), `alternativesRejected` and its
reason, `adaptation: 'elem_match_swap'`, the 158 → 38 triage, the 27 policies,
and the four real `durationMs` values (1718 / 2254 / 1135 / 1102) which set the
relative length of each pulse in step 6. Alternative rejected: fetching a live
trace from `GET /submissions/:id`, which would be more honest still but makes a
marketing page depend on the API being up. The prose panels beside it are
already hardcoded transcriptions of the same run; this matches them.

**Vanilla three.js, same contract as `tour-house.ts`.** `three@0.186` is
already a dependency. `createAgentScene` returns
`{ setStep, bindBadge, setActive, resize, dispose }` — the page owns state, the
module owns pixels, React never sees a frame. Rejected: React Three Fiber,
which would have been faster to author and added a dependency family to a
codebase that already has two working imperative scenes.

**Labels are DOM, not sprites.** Projected to screen space by the scene, the
same way the house scene places its badges, so they render in real Fraunces.
They are rendered only once the scene is live rather than left in the document
as hidden furniture.

## Fallbacks

- No WebGL: the stage never mounts, no canvas and no badges are created, and
  the section is exactly the document it was before. This is the jsdom path, so
  it is the one the tests cover.
- Below `62rem`: the graph needs width to be read at all, so it is dropped
  rather than shrunk. The panels are the content.
- `prefers-reduced-motion`: steps snap to their settled state and the step-6
  loop does not cycle.
- An `IntersectionObserver` stops the render loop when the section is off
  screen, because `tour-house.ts` is running its own loop higher up the page
  and both must not spin at once.

## Not done

Live trace fetching, hover-to-inspect nodes, scrubbing, and a full labelled
schema. The camera poses and the tick-grid placement are authored blind and
have not been checked in a browser — see the open item in the session notes.
