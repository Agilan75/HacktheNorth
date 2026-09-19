import type { ReactElement } from 'react';
/** One horizontal bar. The label and the count are always printed as text. */
export interface BarListItem {
    readonly key: string;
    readonly label: string;
    readonly count: number;
    /** Optional non-colour mark printed before the label (e.g. a verdict glyph). */
    readonly mark?: string;
    /** Bar fill; defaults to Muted deep. */
    readonly fill?: string;
    /** Bar outline; defaults to the fill. */
    readonly stroke?: string;
}
export interface BarListProps {
    /** Accessible name of the chart, also the caption of the screen-reader table. */
    readonly title: string;
    readonly items: readonly BarListItem[];
    /** Shown instead of the chart when there are no items. */
    readonly emptyLabel?: string;
    /** Header for the count column of the screen-reader table. */
    readonly countLabel?: string;
}
/** ViewBox geometry, in SVG user units. */
export declare const BAR_LIST_GEOMETRY: {
    readonly width: 640;
    readonly rowHeight: 32;
    readonly barHeight: 18;
    readonly labelWidth: 220;
    readonly countWidth: 56;
    readonly padTop: 4;
};
/**
 * Width of one bar in user units: proportional to `count / max`, zero when
 * `max` is zero. Exported so the proportionality is testable.
 */
export declare function barWidth(count: number, max: number, plotWidth: number): number;
/**
 * Hand-written SVG horizontal bar chart. Colour never carries meaning alone:
 * every bar prints its label (and optional mark) and its count, and the same
 * numbers are repeated in a visually hidden table for screen readers.
 */
export declare function BarList(props: BarListProps): ReactElement;
//# sourceMappingURL=BarList.d.ts.map