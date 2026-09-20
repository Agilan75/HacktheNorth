import type { ReactElement } from 'react';
import type { FlipPanelProps } from './types.js';
/**
 * PRD 10 (g) Minimal flip with new score and price.
 *
 * The smallest move (at most two movable components, INTERPRETATIONS F-1, F-2)
 * that lands the account in FIT, with the score and premium after it. Every
 * number comes from `flip`; nothing is recomputed (PRD 10, 13).
 *
 * `premiumBefore` / `premiumAfter` are the engine's *predicted* premium (flip.ts
 * prices the vector, not the quote), so they are labelled "Predicted premium"
 * (R5-2). The quoted figure lives in panel (d).
 */
export declare function Flip(props: FlipPanelProps): ReactElement;
//# sourceMappingURL=Flip.d.ts.map