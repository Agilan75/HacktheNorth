import type { StepId } from './tour-agent-graph.js';
/**
 * The DOM elements the scene positions: one per node for its resource name,
 * plus a single readout whose text the page sets per step and whose anchor
 * moves with the step. Labels are DOM rather than sprites so they render in
 * real Fraunces at real hinting, the way the rest of the page does.
 */
export declare const BADGE_IDS: readonly ["submission", "policy", "insured", "claim", "exposureUnit", "location", "building", "readout"];
export type BadgeId = (typeof BADGE_IDS)[number];
export interface AgentScene {
    /** Jump the timeline to the start of a step, then carry on playing from it. */
    setStep(step: StepId): void;
    /** Register the element that tracks a badge. Pass null to unregister. */
    bindBadge(id: BadgeId, el: HTMLElement | null): void;
    /**
     * Whether the section is on screen. Playing is paused off screen — the tour
     * already runs a second scene above this one and only one of them should be
     * spinning a rAF loop — but the position is kept, so scrolling back does not
     * restart the film from the top.
     */
    setActive(active: boolean): void;
    resize(): void;
    dispose(): void;
}
export interface AgentSceneOptions {
    readonly reducedMotion: boolean;
    /** Called whenever the film moves to a new step, so the page can follow it. */
    readonly onStep?: (step: StepId) => void;
    /**
     * Called once, when the last step has finished playing. The page uses it to
     * let the reader out of the pinned section.
     */
    readonly onEnd?: () => void;
}
export declare function createAgentScene(host: HTMLElement, options: AgentSceneOptions): AgentScene;
/**
 * The card that hangs off the graph, one per step: what is happening, then the
 * fact underneath it.
 *
 * Written as sentences rather than as arrow notation. `158 → 38, one query`
 * is a thing you decode; `One query. 158 submissions, 38 kept.` is a thing you
 * read, and the card is on screen for under two seconds. The label is a plain
 * noun phrase in sentence case, never a raw field path — those are long enough
 * to break the box, and the prose panel beside the graph already spells them
 * out for anyone who wants them.
 *
 * Every number still comes from the transcribed constants, so the card cannot
 * drift away from the run it describes.
 */
export declare const READOUTS: Readonly<Record<StepId, {
    readonly label: string;
    readonly value: string;
}>>;
//# sourceMappingURL=tour-agent.d.ts.map