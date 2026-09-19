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
 * Stub frozen by W0-4; unit C13 replaces this body only.
 */
export declare function Tooltip(_props: TooltipProps): ReactElement;
//# sourceMappingURL=Tooltip.d.ts.map