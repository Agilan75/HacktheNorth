import type { ReactElement } from 'react';
import type { ScoreBreakdownPanelProps } from './types.js';
/**
 * PRD 10 (b) Eight factors with tier, weight, points, citation and quote.
 *
 * Renders the engine's factor rows verbatim. The total is the `appetiteScore`
 * prop, never a re-sum of the rows (PRD 10: no panel recomputes a score). A
 * missing factor shows 0 points and the word "Missing" (INTERPRETATIONS G-2).
 */
export declare function ScoreBreakdown(props: ScoreBreakdownPanelProps): ReactElement;
//# sourceMappingURL=ScoreBreakdown.d.ts.map