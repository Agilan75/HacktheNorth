import type { ReactElement, ReactNode } from 'react';
export interface TooltipProps {
    /** Glossary term key; C13 resolves the definition from GET /glossary. */
    readonly term: string;
    readonly children: ReactNode;
    /** Fallback text when the term is not in the glossary. */
    readonly fallback?: string;
}
/**
 * Glossary-powered tooltip (PRD §10 /glossary: "also powers tooltips").
 * Keyboard reachable and described by aria-describedby, never hover-only.
 *
 * The description element is always in the DOM so screen readers get the
 * definition on focus; the visual bubble opens on hover or focus and closes
 * on blur, mouse leave, or Escape.
 */
export declare function Tooltip(props: TooltipProps): ReactElement;
//# sourceMappingURL=Tooltip.d.ts.map