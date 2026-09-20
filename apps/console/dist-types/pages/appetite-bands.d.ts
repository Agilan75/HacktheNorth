/**
 * The TIV and premium appetite bands, read out of `GET /rules` rather than
 * hard-coded: the `AG-TIV-*` and `AG-PREM-*` rules carry their own edges, so
 * the terrain's cliffs sit exactly where the rulebook puts them and each one
 * can name the rule that made it.
 *
 * Nothing here scores anything. It turns a set of AND-ed numeric conditions
 * into the intervals they cut the axis into, with the tier and rule id of the
 * rule that owns each interval. `FALLBACK_BANDS` covers an API that predates
 * the rules route; it repeats the numbers in `packages/engine/src/constants.ts`
 * and is reported so the page can say the edges are built in.
 */
/** Tier value as the engine scores it (constants.ts TIER_VALUE). `refer` never reaches these two factors. */
export declare const TIER_VALUE: Readonly<Record<string, number>>;
export type BandTier = 'target' | 'acceptable' | 'not_acceptable';
export interface Band {
    /** Inclusive lower edge; `-Infinity` for the open end. */
    readonly from: number;
    /** Exclusive upper edge; `Infinity` for the open end. */
    readonly to: number;
    readonly tier: BandTier;
    readonly tierValue: number;
    /** The rule that puts this interval in that tier, e.g. `AG-TIV-NA`. */
    readonly ruleId: string;
}
export interface AppetiteBands {
    readonly tiv: readonly Band[];
    readonly premium: readonly Band[];
    /** True when the rules route could not be read and the built-in numbers are in use. */
    readonly fallback: boolean;
}
interface RuleLike {
    readonly id: string;
    readonly factor: string;
    readonly tier: string;
    readonly when: readonly {
        readonly field: string;
        readonly op: string;
        readonly value?: unknown;
    }[];
}
/**
 * Cut one axis at every edge its rules name, then ask each rule which interval
 * it owns. Adjacent intervals with the same rule are merged.
 */
export declare function bandsFor(rules: readonly RuleLike[], factor: string, field: string): Band[];
/** The engine's own numbers (constants.ts), used only when `/rules` cannot be read. */
export declare const FALLBACK_BANDS: AppetiteBands;
/** Bands from the `/rules` payload, or the built-in ones when it yields too few to draw. */
export declare function appetiteBands(rulebooks: readonly unknown[] | null | undefined): AppetiteBands;
/** The band a value falls in, or null when it is unknown. */
export declare function bandAt(bands: readonly Band[], value: number | null): Band | null;
export {};
//# sourceMappingURL=appetite-bands.d.ts.map