# Verification

Generated 2026-09-20T10:38:29.929Z (run started 2026-09-20T10:00:34.817Z). PRD §12. Every count below is the number of cases actually completed, not the number requested.

## Headline

| Layer | Cases completed | Result |
| --- | --- | --- |
| A. Property tests | 1,257,983 | 0 invariant violations |
| B. Differential (naive second implementation) | 1,257,983 | 0 disagreements |
| C. LLM second opinion | 0 | not run |

## Layers A and B

- Requested: 10,000,000 cases, seed 20260919, 6 workers, chunk size 10,000.
- Completed: 1,257,983 cases (8,742,017 short of the 10,000,000 requested).
- Throughput: 553 cases per second.
- Invariant violations: 0.
- Engine-versus-naive disagreements: 0.
- Cases that threw: 0.

## Layer C: LLM second opinion

Layer C has not been run. Run `npm run verify:llm`.

## Caveats

- Layer C is capped: agreement stops moving after a few thousand stratified cases, and ten million model calls would cost thousands of dollars.
- The model is the less reliable party. A layer-C disagreement is a lead, not proof the engine is wrong.
- The app also uses Gemini, so layer C is a weaker independent check than a second vendor would be. Layer B is the real correctness check.
- The model sees only the guideline text and the rolled-up facts. It never sees engine output.
