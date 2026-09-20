/** GET /verification/field. Counts are per verdict, in `verdicts` order. */
export interface FieldSummary {
    readonly seed: number;
    readonly total: number;
    readonly generatedAt: string;
    readonly verdicts: readonly string[];
    readonly factors: readonly string[];
    readonly strata: readonly {
        readonly key: string;
        readonly description: string;
    }[];
    readonly byVerdict: readonly number[];
    /** Row 0 is "no deciding factor", then one row per factor. */
    readonly byFactor: readonly (readonly number[])[];
    /** Row 0 is "ordinary case", then one row per stratum. */
    readonly byStratum: readonly (readonly number[])[];
    readonly scoreHistogram: readonly (readonly number[])[];
    readonly fromSubmission: number;
    readonly onThreshold: number;
}
export declare const COLOR_BY: readonly ["verdict", "factor", "score"];
export type ColorBy = (typeof COLOR_BY)[number];
/** What is kept at full strength; everything else is washed toward the surface. */
export type Highlight = {
    readonly kind: 'none';
} | {
    readonly kind: 'threshold';
} | {
    readonly kind: 'submission';
} | {
    readonly kind: 'stratum';
    readonly index: number;
};
export declare const verdictOf: (byte: number) => number;
export declare const factorOf: (byte: number) => number;
export declare const isFromSubmission: (byte: number) => boolean;
export declare const isOnThreshold: (byte: number) => boolean;
export declare const SURFACE = "#FAF8F2";
/** PRD 13 verdict colours: FIT red, REFER amber, DOES_NOT_FIT ink. Always shown with the word and the count. */
export declare const VERDICT_COLORS: readonly ["#E4002B", "#EDA100", "#1F1E1B"];
/** "No deciding factor" in neutral grey, then the eight factors in fixed categorical order. */
export declare const FACTOR_COLORS: readonly ["#B9B8B0", "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
export declare function scoreColor(score: number): readonly [number, number, number];
export declare function cssColor(c: readonly [number, number, number]): string;
export interface FieldLayers {
    readonly cases: Uint8Array;
    readonly scores: Uint8Array | null;
    readonly strata: Uint8Array | null;
}
/**
 * Pixel position -> case index with like cases together (a stable counting
 * sort on the colour key, so run order is kept inside each band).
 */
export declare function groupedOrder(layers: FieldLayers, colorBy: ColorBy): Uint32Array;
/** Side of the square that holds `total` pixels. */
export declare function fieldSide(total: number): number;
/** Paints every case into `out` (a `side * side` RGBA buffer viewed as uint32), row-major in `order`. */
export declare function paintField(out: Uint32Array, layers: FieldLayers, order: Uint32Array | null, colorBy: ColorBy, highlight: Highlight): void;
/** A random case that passes `test`, or null when none turned up. */
export declare function randomCase(total: number, test: (index: number) => boolean, random?: () => number): number | null;
export interface CaseCitation {
    readonly doc: string;
    readonly section: string;
    readonly quote: string;
}
export interface ExplainedFactor {
    readonly factor: string;
    readonly tier: string | null;
    readonly tierValue: number | null;
    readonly weight: number;
    readonly points: number;
    readonly knockout: boolean;
    readonly refer: boolean;
    readonly ruleId: string | null;
    readonly citation: CaseCitation | null;
    readonly naiveTier: string | null;
    readonly naiveTierValue: number | null;
    readonly naivePoints: number | null;
}
export interface ExplainedSide {
    readonly verdict: string;
    readonly appetiteScore: number;
    readonly completeness: number;
    readonly decidingFactorId: string | null;
    readonly knockoutFactorIds: readonly string[];
}
export interface ExplainedCase {
    readonly caseId: string;
    readonly seed: number;
    readonly index: number;
    readonly stratum: string | null;
    readonly fromSubmission: boolean;
    readonly buildings: readonly {
        readonly id: string;
        readonly state: string | null;
        readonly yearBuilt: number | null;
        readonly constructionType: string | null;
        readonly tiv: number | null;
    }[] | null;
    readonly input: Readonly<Record<string, string | number | boolean | null>>;
    readonly boundaries: Readonly<Record<string, string>>;
    readonly engine: ExplainedSide & {
        readonly decidingRule: {
            readonly ruleId: string;
            readonly factor: string;
            readonly tier: string;
            readonly citation: CaseCitation;
        } | null;
        readonly reasons: readonly string[];
    };
    readonly naive: ExplainedSide & {
        readonly referReasons: readonly string[];
    };
    readonly factors: readonly ExplainedFactor[];
    readonly agreed: boolean;
    readonly disagreements: readonly {
        readonly field: string;
        readonly engine: unknown;
        readonly naive: unknown;
    }[];
    readonly invariants: readonly {
        readonly suite: string;
        readonly name: string;
        readonly violations: readonly string[];
    }[];
}
//# sourceMappingURL=verification-field.d.ts.map