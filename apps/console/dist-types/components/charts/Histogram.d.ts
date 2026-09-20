import type { ReactElement } from 'react';
export interface HistogramBucket {
    /** Axis label, e.g. `70–79`. */
    readonly label: string;
    readonly count: number;
}
export interface HistogramProps {
    readonly title: string;
    readonly buckets: readonly HistogramBucket[];
    /** Text under the axis, e.g. `Appetite score`. */
    readonly xLabel?: string;
    readonly emptyLabel?: string;
}
/** ViewBox geometry, in SVG user units. */
export declare const HISTOGRAM_GEOMETRY: {
    readonly width: 640;
    readonly height: 260;
    readonly padLeft: 8;
    readonly padRight: 8;
    readonly padTop: 24;
    readonly padBottom: 48;
    readonly gap: 6;
};
/** Column height in user units: proportional to `count / max`, zero when `max` is zero. */
export declare function columnHeight(count: number, max: number, plotHeight: number): number;
/**
 * Hand-written SVG column histogram. Every column prints its count above it and
 * its bucket below it; a visually hidden table repeats the numbers.
 */
export declare function Histogram(props: HistogramProps): ReactElement;
//# sourceMappingURL=Histogram.d.ts.map