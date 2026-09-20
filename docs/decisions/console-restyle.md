# Decisions — console restyle to the mobile design language

**Scope:** `apps/console` only. Colour, shape and type. No copy, no data, no routes,
no DTOs, no new dependencies. Nothing frozen was touched: `App.tsx`, `tokens.css`,
`packages/design/src/tokens.ts`, every `package.json` and every barrel are as they were.

---

## The problem this fixes

The `feat/ar-sweep` mobile rework replaced the palette in `@retrofit/design` and was
told not to restyle the console. To keep the console compiling it left a block of
aliases at the bottom of `COLORS` pointing the console's old token names at the nearest
new colour, and recorded the cost in `docs/decisions/mobile-rework.md`.

The cost turned out to be larger than "different colours". Three separate names
collapsed onto one value, so rules that used to be distinguishable became identical:

| Console alias | Now resolves to | Was meant to be |
| --- | --- | --- |
| `blueTint`, `greenTint`, `redTint` | all `#E9E4DA` (mute-tint) | three different tints |
| `blueDeep`, `greenDeep` | both `#191919` (ink) | two different colours |
| `mutedDeep`, `muted` | both `#8A8478` (mute) | a dark grey and a mid grey |

So `Badge tone="info"`, `tone="positive"` and `tone="neutral"` rendered the same; the
adapter banner's "live" state rendered as a grey pill; and the three verdict pills used
a mapping (FIT = red filled, REFER = red outlined, DOES_NOT_FIT = ink filled) that no
longer matched the one the phone renders from the same `VERDICT_STYLES`.

The console also had a contrast regression: `mutedDeep` is spent on 13px and 15px
secondary text — table headers, stat labels, captions, footnotes — and `mute` is
3.24:1 on bone, which is AA-large only.

## Decision 1 — express tone with fill and edge, not with new hues

**Decided:** the console adopts the phone kit's rule that emphasis is a border, never a
shade, and it keeps the phone's colour meanings exactly: accent is the only accent,
amber means REFER and nothing else, red means DOES_NOT_FIT (and a problem) and nothing
else, ink and the two greys do everything else.

Five badge tones out of four colours, told apart by shape:

| Tone | Fill | Edge |
| --- | --- | --- |
| quiet | none | none |
| neutral | mute-tint | none |
| info | bone | 1px ink |
| attention | bone | 2px accent |
| positive | ink | ink (bone words) |

The adapter banner follows the same rule: live is bone with a 2px accent edge — the
"on" state, the shape `Card tone="accent"` takes on the phone — and everything else is
a plain mute-tint fill.

**Rejected:** reintroducing tints (`color-mix(var(--rf-red) 16%, var(--rf-bone))` and
friends) to restore five distinguishable hues. It would have worked and it passes
contrast, but it would have put amber and red on things that are not verdicts, which is
precisely the discipline PRD §13 asks for and the phone kit keeps.

## Decision 2 — verdict pills come from `VERDICT_STYLES`, not from a second mapping

**Decided:** FIT is accent-filled, REFER is amber-filled, DOES_NOT_FIT is red-filled
with bone words, each with a 2px edge — identical to `verdictPillStyle()` on the phone.
The C02 test that pinned the old mapping was updated, and a new test asserts the CSS
fills match `VERDICT_STYLES[verdict].fill` so the two cannot drift again.

The same change removes the `verdict === 'REFER' ? COLORS.redTint : style.fill`
stand-in in `explore-scene.ts` and `ExplorePage.tsx`. It existed because REFER used to
be an outlined pill with no fill to borrow; REFER is amber-filled now, so a REFER point
in the 3D book is the colour of the pill beside it and of the pill on the phone.

## Decision 3 — one local token override, for contrast

**Decided:** `base.css` redefines exactly one alias:

```css
--rf-muted-deep: color-mix(in srgb, var(--rf-mute) 70%, var(--rf-ink));
```

5.14:1 on bone and 4.65:1 on mute-tint, so every 13px and 15px secondary line clears AA.
It is derived from two tokens, so it still moves when the palette moves, and it is the
only override in the file.

**Rejected:** (a) editing `packages/design/src/tokens.ts`, which is frozen and shared
with the phone, where `mute` is correct as it stands; (b) sweeping the ~50 call sites
that name `cssVar('muted-deep')` onto a different token, which would have touched a
dozen files owned by other units during a parallel build for no visual gain.

`color-mix` is Baseline 2023 and the console targets a modern browser. `tokens.css`
stays generated and byte-identical to `cssVariableBlock()`; its own test still passes.

## Decision 4 — links are ink, not red

**Decided:** `a` is ink with an underline, hovering to accent. The underline is the
affordance, which is what the phone kit's `quiet` button does.

**Rejected:** keeping `--rf-red-deep` on links. It reads at 4.76:1 and would have been
fine on contrast, but red is DOES_NOT_FIT now and a page of red links undoes that.

## Decision 5 — `[role="button"]` no longer gets button chrome

**Decided:** only `button` and `a.rf-button` take the pill, the 2px edge and the 44px
minimum. The one element in the console carrying `role="button"` is the glossary
tooltip trigger, a `<span>` inside a sentence; the previous rule gave it a bordered pill
mid-paragraph. WCAG 2.5.8 exempts a target inline in a block of text from the minimum
size, and `.rf-tooltip__trigger` now explicitly resets to inline with a dotted underline.

## Decision 6 — the lead stat borrows the price's silhouette, not its colour

**Decided:** `.rf-stat--lead` (the predicted premium) is a bone tile with a 2px accent
edge and the figure one type step larger — the shape the phone gives its price — but
the figure stays **ink**.

**Rejected:** accent on the figure, to match the phone exactly. Accent is 2.73:1 on
bone; §13 makes that concession once, for a price that is the only thing on a phone
screen. A console tile sits in a grid of five and is read all day, so the accent points
and ink reads. One line in `base.css` reverses this if the demo wants the terracotta
figure.

## Known deviation left in place

`ExplorePage`'s scatter legend says "Red frame: 100% adequacy", and the reference frame
in `explore-scene.ts` is drawn in `COLORS.red`. Red otherwise means DOES_NOT_FIT. The
copy names the colour, so recolouring the frame means editing the legend text, which is
content and out of scope for this pass. Flagged rather than changed.

## Verification

- `npx tsc --noEmit -p apps/console` — clean.
- `npx vitest run --project console` — 34 files, 243 tests, all passing.
- `npx vite build` in `apps/console` — builds; the override is emitted after
  `tokens.css` in the bundled stylesheet, so it wins on order as well as on being last.
