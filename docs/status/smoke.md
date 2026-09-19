# S1 — end-to-end smoke (2026-09-19)

Run by the orchestrator, not an agent, against the **live** Federato API and **live** Gemini.

## Seed (live)

`npm run seed` — adapter **live**, 4 planner queries in 9.2 s.
**158 submissions stored, 158 scored, 158 with a query trace** (PRD 15 ✓).
120 knocked out at triage, 11 without a policy. No credential appears anywhere in the log.

Enrichment: **OpenFEMA flood worked across the book** (28 values over 27 accounts).
**Overpass fire-station distance was mostly unavailable** — the public Overpass mirrors
returned HTTP 429, timeouts and connection failures; only 2 of 27 accounts got a value.
It degraded exactly as PRD 8 requires (an "unavailable" card, never a crash or an
invented number), but on the night it contributed almost nothing. Treat it as a
best-effort plugin, not a demo beat.

## Every endpoint (live)

13 calls, **0 non-2xx**: `GET /health`, `/submissions`, `/submissions/:id`,
`POST /submissions/:id/run`, `POST /enrich/:id`, `GET /aggregate`, `/rules`,
`/glossary`, `/s/:slug`, `POST /actions/plan`, `GET /actions`,
`POST /actions/:id/approve`, `POST /submissions/:id/reply`, `GET /sweeps/:id`,
`GET /sweeps/:id/next-question`.

**Live Gemini ran the Rox loop end to end.** A conversational broker reply
("The main building was built in 1998, it's joisted masonry, and total insured value
is about $64.5M. Five-year losses total $42,000.") became four typed fields, each with
its verbatim source quote, each checked by code to appear in the text before being
accepted. The account (SUB-2026-00118, Lakeside Medical Group LLC) re-scored and
moved **rank 8 → rank 2**.

Book: **1 FIT, 11 REFER, 146 DOES_NOT_FIT** — consistent with PRD 7.2's "few will be FIT".

## Latency fixed during the smoke

| Call | Before | After | Fix |
| --- | --- | --- | --- |
| `POST /actions/plan` | **114.7 s** | 36.2 s, then instant after seed | Drafts ran serially against live Gemini. Now drafted 8 at a time; an unchanged open draft is reused, not re-drafted; `npm run seed` plans actions so the outbox is ready before anyone opens the console. (DECISIONS S1-1) |
| `GET /submissions/:id` first open | 5.2 s | 0.02 s on re-open | Live Gemini `narrate` on first view, cached after. Left as is. |

## Console (real browser, headless Chromium)

Every route renders with **zero browser-console errors**: `/queue`,
`/submissions/:id` (a FIT and a REFER account), `/actions`, `/rules`, `/glossary`,
`/aggregate`. `vite build` succeeds (460 KB JS, 139 KB gzipped) and the bundle
contains **no credential and no secret variable name**.

Verified on screen: the "Data source: Live Federato API" banner on every page; all
twelve submission panels (a)–(l); every factor citing its APPETITE_GUIDELINES.pdf row
verbatim; the query trace rendered as reasoning ("Went to Submission because…",
"Considered and rejected: Policy — only 113 of 158 submissions have a policy…");
the synthetic-contacts disclosure on the Actions page.

**Console binding bug fixed:** Vite listened on IPv6 `[::1]` only, so a browser
resolving `localhost` to `127.0.0.1` got a connection error. Pinned to `127.0.0.1`.
(DECISIONS S1-2)

The connected Chrome extension could not reach this machine's localhost at all (it
loaded an error page even for the API, which curl reached on the same address), so
the walk used a local headless Chromium instead.

## Snapshot fallback

`FEDERATO_BASE_URL=` → `/health` reports `adapter: mock`, 158 submissions, and the
banner `*** FEDERATO: SNAPSHOT (MockFederatoAdapter) - NOT the live API ***`. No code
change (PRD 15 ✓).

## Honest finding: no account in the real book has a minimal flip

All 37 non-FIT property accounts return `flip: null`, each **with a stated reason**:
the building-age share ("pctTivPre1990 cannot be changed", 5, plus 4 jointly with
state), the state ("stateTier cannot be changed", 4), renewal status, or "no move over
at most two components reaches FIT" (3). Every declined account in this dataset fails
on at least one factor the insured cannot change. That is the data, not a defect — the
flip is exercised on synthetic and tenant cases in the test suite. In a demo, show the
*reason*: it tells a broker why no premium change can rescue the account.
