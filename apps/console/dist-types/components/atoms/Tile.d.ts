import type { ReactElement, ReactNode } from 'react';
/**
 * One headline figure: a big number over a small label, optionally linking
 * somewhere. Extracted from the near-duplicate local `Tile` that
 * AggregatePage and VerificationPage each carried.
 *
 * Always rendered inside a `<dl>`: the label is the `<dt>`, the value the
 * `<dd>`. When `href` is set, a stretched link covers the whole tile so the
 * hit area is the tile, not the words.
 */
export type TileTone = 'neutral' | 'positive' | 'attention' | 'info';
export interface TileProps {
    readonly label: string;
    readonly value: ReactNode;
    readonly detail?: ReactNode;
    readonly tone?: TileTone;
    /** When set the whole tile is a link to this route. */
    readonly href?: string;
    /** Optional `data-testid` on the tile element. */
    readonly testId?: string;
}
export declare function Tile(props: TileProps): ReactElement;
//# sourceMappingURL=Tile.d.ts.map