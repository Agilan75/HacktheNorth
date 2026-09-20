import type { ReactElement } from 'react';
export interface BadgeProps {
    readonly label: string;
    readonly tone?: 'neutral' | 'attention' | 'quiet';
    readonly title?: string;
}
/**
 * A small labelled badge, e.g. '1 flip from FIT'. Tone is decoration; the label carries the meaning.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export declare function Badge(props: BadgeProps): ReactElement;
//# sourceMappingURL=Badge.d.ts.map