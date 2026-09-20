/** Every point in the room a badge can hang off. */
export declare const ANCHOR_IDS: readonly ["heater", "curtain", "bed", "detector", "desk", "fix"];
export type AnchorId = (typeof ANCHOR_IDS)[number];
export interface HouseScene {
    /** Set the camera's position along the rail, 0 at the door, 1 at the wide shot. */
    setProgress(t: number): void;
    /** Register the DOM element that should track an anchor. Pass null to unregister. */
    bindBadge(id: AnchorId, el: HTMLElement | null): void;
    resize(): void;
    dispose(): void;
}
export declare function webglAvailable(): boolean;
export declare function createHouseScene(host: HTMLElement, reducedMotion: boolean): HouseScene;
//# sourceMappingURL=tour-house.d.ts.map