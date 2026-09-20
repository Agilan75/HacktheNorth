/**
 * FROZEN (W0-4) — the prop contract for every panel of PRD §10 (a)–(l) and for
 * the shared console views.
 *
 * Why these types are declared here and not imported from `@retrofit/contracts`:
 * W0-3 was still writing `packages/contracts/src/dto.ts` when this file was
 * frozen. Every shape below is a *structural subset* of the DTO the API returns,
 * derived from PRD §10, so the real DTO stays assignable to it. C01 types the
 * API client against `@retrofit/contracts` and passes those objects straight
 * into these props. See docs/contracts/requests/W0-4.md.
 *
 * House rule the panels inherit (PRD §10, §13): every number rendered must come
 * from one of these props. No panel recomputes a score, a premium or a tier, and
 * colour never carries meaning alone — a pill always carries its label text.
 */
export {};
//# sourceMappingURL=types.js.map