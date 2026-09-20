import type { ReactElement } from 'react';
export interface BadgeProps {
    readonly label: string;
    /**
     * `attention` (Red tint) still means "needs a look", never "bad" (PRD §13).
     * `positive` (Green) marks a completed, healthy state (sent, available,
     * moved up) and `info` (Blue) marks a neutral fact — both are decoration
     * on top of the label text, which always carries the meaning on its own.
     */
    readonly tone?: 'neutral' | 'attention' | 'quiet' | 'positive' | 'info';
    readonly title?: string;
}
/**
 * A small labelled badge, e.g. '1 flip from FIT'. Tone is decoration; the label carries the meaning.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export declare function Badge(props: BadgeProps): ReactElement;
//# sourceMappingURL=Badge.d.ts.map