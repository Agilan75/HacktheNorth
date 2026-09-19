# Retrofit demo script

Two cuts. The Federato + Rox cut runs on a laptop. Every API call in it has been exercised against the live Federato API and live Gemini, and every console page renders; the full click-path through the console UI has not been rehearsed by a person yet, and live reply extraction needs the Gemini credits topped up. The Intact cut runs on an iPhone and has **not yet been run on a device**.

---

## Pre-flight checklist

Do these in order, before judges arrive. Every command runs from the repo root, `/Users/calebchincalebchin/hackthenorth`.

1. **Top up the Gemini credits first.** The key's prepaid credits are depleted (HTTP 402). Top up in Google AI Studio. Without credits, step 4 (live reply extraction) fails. The API banner still says "Gemini: configured" when the credits are gone, so it will not warn you.
2. **Keep the already-replied database as a fallback.** With nothing running:
   ```sh
   cp apps/api/data/retrofit.db ~/retrofit-after-reply.db
   ```
   This copy already holds the Lakeside reply (rank 8 -> 2). The Fallbacks section explains how to use it.
3. **Reset and seed.** The current database already has the demo reply applied, so step 4 would have nothing left to show. Start clean:
   ```sh
   rm -f apps/api/data/retrofit.db*
   npm run seed
   ```
   Seeding ingests all 158 submissions, scores them, runs enrichment, stores the seeded bedroom sweep and **drafts the broker requests**, so the outbox is ready. Drafting takes tens of seconds against live Gemini, so do it now and never live on stage. Expect `158 scored` and a line ending `request drafts ready`.
4. **Start the API** (terminal 1): `npm run dev:api`. It listens on port 3000.
5. **Start the console** (terminal 2): `npm run dev:console`.
6. **Open** http://127.0.0.1:5173. Use `127.0.0.1`, not `localhost`. Confirm the header banner reads **Data source: Live Federato API**.
7. **Rehearse step 4 once, then reset again.** A rehearsal uses up the demo reply. After it, stop the API, then repeat step 3 and restart the API.
8. Open these tabs in advance:
   - http://127.0.0.1:5173/submissions/SUB-2026-00081 (Coastal Freight Systems LLC, the one FIT account)
   - http://127.0.0.1:5173/submissions/SUB-2025-00042 (Anchor Transport LLC, used for the flip reason)
   - http://127.0.0.1:5173/actions
9. Copy the broker reply for step 4 to your clipboard:
   ```
   The main building was built in 1998, it's joisted masonry, and total insured value is about $64.5M. Five-year losses total $42,000.
   ```

---

## Cut 1: Federato + Rox (console)

### 1. The agent's reasoning trail (show this first)

**Point: the agent decides how to query Federato and says why, including the paths it turned down.**

- Open any submission. The Coastal Freight tab works.
- Scroll to panel (c), **How the agent got here**.
- Point at **Considered and rejected**, e.g. "Policy — only 113 of 158 submissions have a policy…".
- Say: "The planner read the schema, chose where to start, and wrote down the roads it didn't take. Four planner queries loaded the whole book in 9.2 seconds. The deep pass returns all 27 property policies fully hydrated in one query."
- Optional: expand **Query payload** to show the actual query.

### 2. The ranked queue

**Point: out of 158 submissions, 1 fits.**

- Click **Queue** in the header.
- Say: "1 FIT, 11 REFER, 146 DOES_NOT_FIT. 120 of those were knocked out at triage because they aren't property business. The collapsed group at the bottom is **Out of appetite: line of business**. The guidelines are strict, and the PRD predicted that few accounts would fit."
- Point at row 1: **Coastal Freight Systems LLC**, FIT, appetite 88/100.

### 3. One account in depth

**Point: every number traces to a guideline row, and every judgement call is labelled.**

On **SUB-2026-00081, Coastal Freight Systems LLC**:
- Panel (a) **Explanation and recommendation**: FIT, with the deciding rule quoted from APPETITE_GUIDELINES.pdf.
- Panel (b) score breakdown: each factor cites its PDF row verbatim.
- Panel (f) **Contradictions and interpretations** → **Interpretations applied**. Point at **I-1**: "The guideline names no field for primary state, and policies span up to four states. So we use the state carrying the largest share of TIV, and we say so on the page."

Then switch to **SUB-2025-00042, Anchor Transport LLC**, panel (g), the flip panel:
- It reads: *No flip reaches FIT within two movable components.* followed by the reason *Every failing component is immovable: pctTivPre1990.*
- Say: "No declined account in this book has a minimal flip. Almost every one fails on something the insured cannot change, like building age or state, and the engine names which one; the few that fail only on premium would need more than a two-component move. The value for a broker is knowing that no premium change or risk control will rescue this account, so they can stop working it." (The flip itself is exercised on synthetic and tenant cases in the tests.)

### 4. The action loop, live

**Point: a messy broker email becomes typed fields, and the account's score and rank update.**

1. Go to **Actions** (http://127.0.0.1:5173/actions). Point at the notice: broker contacts are synthetic, so approving marks a request sent and nothing is emailed.
2. In **Outbox**, find **Lakeside Medical Group LLC**. Several insureds share the "Lakeside Medical Group" name, so pick the **LLC** row, which is SUB-2026-00118. Click **Approve**.
3. Click the insured name to open the submission. Scroll to panel (k) **Actions** → **Broker reply**.
4. Paste into **Paste the broker's reply**:
   ```
   The main building was built in 1998, it's joisted masonry, and total insured value is about $64.5M. Five-year losses total $42,000.
   ```
   Click **Extract fields**.
5. Point at the table: four typed fields, each with its **Quoted from the reply** text. Say: "Gemini proposes the values, and code checks that each quote actually appears in the reply before a value is accepted." Point at **Before the reply** / **After the reply**.
6. Back on **Actions**, under **Rank movement from replies**: Lakeside Medical Group LLC, **#8 → #2**.

### 5. One line each

- **Price adequacy** (panel (d) on Coastal Freight): "Quoted $58,800 against a predicted $62,725, factor by factor."
- **Peers** (panel (d), **Peer benchmark**): "The five nearest accounts in the book, with distance, rate and losses."
- **Verification**: "We checked the engine against its own invariants and against a separately written naive implementation. The 100K run found 0 violations and 0 disagreements, and the 10M results are in VERIFICATION.md. Gemini, given only the guideline text, agreed on 1,331 of 1,332 cases, and on all 38 real property accounts. The one disagreement is exactly-50% construction, which the PDF leaves open. These tests found real bugs: the first run had 20,662 invariant violations, and review of real data found 39 defects. All are fixed."

---

## Cut 2: Intact (phone app)

> **NOT YET RUN ON A DEVICE.** The app typechecks and its logic tests pass (139 tests), but no one has run it on an iPhone. Rehearse it on a real phone before you show it. If it fails, go straight to the seeded-sweep fallback below.

The phone needs Gemini credits, because the sweep and "Verify my fix" both go through the vision call. The coverage overlay is the 2D ring. The 3D dome was cut.

Setup:
```sh
npx cloudflared tunnel --url http://localhost:3000        # terminal 3; copy the https URL
EXPO_PUBLIC_API_URL=https://<tunnel>.trycloudflare.com npm run dev:mobile   # terminal 4
```
Scan the QR code with the iPhone camera to open the app in Expo Go.

1. **Sweep.** Tap **New sweep**. Enter a **Room name**, choose the term under **How long do you want to be covered?**, then tap **Scan the room with the camera**. Turn slowly. Frames capture as the heading advances, and the ring fills in. Finish unlocks at 75% coverage. If the camera fails, use **Use 3 photos instead**.
2. **Confirm.** For each low-confidence item, tap **Yes, it's there** or **No, it isn't**.
3. **Questions.** They come one at a time in plain language. **Skip — I'm not sure** is always available.
4. **Quote.** The verdict screen shows the estimate, the deciding rule and the fix.
5. **Verify the fix.** Tap **Verify my fix**. Choose what you fixed under **What did you fix?**, then **Take a photo** or **Choose a photo from my library**, and tap **Check my fix**. The old and new estimates appear side by side.

---

## Fallbacks

**Wifi or Federato down.** Stop the API and restart it on the saved snapshot:
```sh
FEDERATO_BASE_URL= npm run dev:api
```
The banner changes to show the snapshot (`FEDERATO: SNAPSHOT (MockFederatoAdapter) - NOT the live API`). Say so out loud. The data already in the database is unchanged, so steps 1–3 and 5 run as written. To re-seed offline, run `FEDERATO_BASE_URL= npm run seed -- --no-enrich`.

**Gemini down or out of credits.**
- Still works: all scoring and ranking, the query trace, explanations (built from templates), pricing, peers, flip reasons, the Rules, Glossary and Aggregate pages, and approving drafts. Drafts fall back to a template.
- Does not work: step 4 extraction (**Extract fields** returns an error) and the whole phone cut.
- For step 4, stop the API and restore the replied database:
  ```sh
  cp ~/retrofit-after-reply.db apps/api/data/retrofit.db
  ```
  Restart the API, open **Actions** and show **Rank movement from replies** (#8 → #2), then the extracted fields and quotes on SUB-2026-00118's Actions panel. Tell the audience this is the logged result of an earlier live run, not a live extraction.

**Phone fails or there is no device.** `npm run seed` stores a scripted bedroom sweep as `sweep_seed_bedroom`. It needs no camera and no Gemini, but the phone app cannot open it, because the rooms list only shows sweeps sent during the current launch. Show it from the API:
```sh
curl -s http://127.0.0.1:3000/sweeps/sweep_seed_bedroom | jq '.result.verdict'
curl -s http://127.0.0.1:3000/sweeps/sweep_seed_bedroom/next-question | jq
```
It includes a portable heater near a curtain, which the engine pairs as a heater-near-combustible hazard. Say plainly that the phone app has not run on a device.

**Honest limits, if asked.** Broker-reply extraction accuracy was not measured, because the 30-fixture check ran after the credits ran out, so quote no percentage. 706 of the 2,038 planned layer-C cases went unanswered for the same reason. The fire-station enrichment reached only 2 of 27 accounts because the public mirrors were rate-limited. Flood data covered the whole book.
