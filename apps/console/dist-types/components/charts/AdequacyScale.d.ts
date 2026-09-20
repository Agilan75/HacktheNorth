import type { ReactElement } from 'react';
export interface AdequacyScaleProps {
    /** Median of `quotedPremium ÷ predictedPremium` across the book; null when unknown. */
    readonly median: number | null;
    readonly title?: string;
}
/**
 * The scale runs 0 to 2 (0%–200%): the same clamp INTERPRETATIONS P-5 applies
 * to adequacy before it enters the quality index.
 */
export declare const ADEQUACY_DOMAIN_MAX = 2;
export declare const ADEQUACY_GEOMETRY: {
    readonly width: 640;
    readonly height: 96;
    readonly padX: 24;
    readonly trackY: 44;
    readonly trackHeight: 12;
};
/** x position, in user units, of an adequacy ratio on the clamped 0–2 scale. */
export declare function adequacyX(ratio: number): number;
/** Plain-language reading of a median adequacy ratio. Presentation only. */
export declare function adequacyReading(median: number | null): string;
/**
 * Hand-written SVG number line: the book's median adequacy against the 100%
 * line where quoted premium equals predicted premium. The value is printed as
 * text next to the marker, so the position never carries meaning alone.
 */
export declare function AdequacyScale(props: AdequacyScaleProps): ReactElement;
//# sourceMappingURL=AdequacyScale.d.ts.map