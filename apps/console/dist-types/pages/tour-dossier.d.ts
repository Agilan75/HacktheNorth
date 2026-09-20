import type { ReactElement, ReactNode } from 'react';
/**
 * The dossier: everything on `/tour` past the 3D story. It covers the weighted
 * rulebook, the Federato planner, the testing and the limits. Architecture is
 * not here: the camera rail above tells that story. Panels are collapsed by
 * default so the page opens as a table of contents rather than a wall.
 *
 * Nothing here is decorative: the weights come from the live `GET /rules`, and
 * every prose number is one the README, VERIFICATION.md or the engine already
 * states. Where a number is fitted, invented or unmeasured, the panel says so.
 */
/**
 * Arm one element for a scroll reveal and drop the observer again once it has
 * played. Everything is visible without this: the hidden state is only ever
 * applied by `rf-reveal`, which JS adds, and only when the reader has not asked
 * for reduced motion and the browser has an IntersectionObserver.
 *
 * Shared by the whole dossier — the group heads, the figure rows, the panels
 * and the rule sheets all arrive the same way, so the page reads as one pass
 * of a pen rather than four different animations.
 */
export declare function useReveal<T extends HTMLElement>(): (node: T | null) => void;
/** One collapsible panel. Native `<details>`, so it survives with JS disabled. */
export declare function Panel(props: {
    readonly title: string;
    readonly note?: string;
    readonly open?: boolean;
    /**
     * Fired when this panel is opened, never when it is closed. The agent
     * section uses it to move its scene to the matching step; every other
     * caller ignores it and keeps the plain `<details>` behaviour.
     */
    readonly onOpen?: () => void;
    /** Marks this panel as the one the agent scene is currently playing. */
    readonly active?: boolean;
    readonly children: ReactNode;
}): ReactElement;
/**
 * A titled group of panels, with one button that opens or closes all of them.
 * The button walks the group's own `<details>` elements rather than lifting
 * `open` into React state, so each panel keeps its own independent toggle.
 */
export declare function Group(props: {
    readonly id: string;
    readonly title: string;
    readonly lede: string;
    readonly children: ReactNode;
}): ReactElement;
/** Big-number row. `value` is the number; `label` says what it counts. */
export declare function Figures(props: {
    readonly items: readonly {
        readonly value: string;
        readonly label: string;
    }[];
}): ReactElement;
/** Term/value grid. */
export declare function Defs(props: {
    readonly rows: readonly {
        readonly term: string;
        readonly value: ReactNode;
    }[];
}): ReactElement;
export declare function AgentGroup(): ReactElement;
export declare function TestingGroup(): ReactElement;
//# sourceMappingURL=tour-dossier.d.ts.map