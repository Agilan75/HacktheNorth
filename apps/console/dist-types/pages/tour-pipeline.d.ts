/**
 * The tour pipeline: the same room, seen from outside the room.
 *
 * `tour-house.ts` draws one apartment and rails a camera through it. This
 * module draws what happens *after* the sweep: the apartment is one of two
 * front doors into Retrofit, the Federato API is the other, both feed
 * `apps/api`, the engine in the middle does the arithmetic, and three verdicts
 * fall out the far side into the console and the phone.
 *
 * The caller owns the camera, the renderer and the scroll. This module owns a
 * `THREE.Group` and one function. `update(t, elapsed)` is a **pure function of
 * its two arguments** — no stage counters, no "have I fired yet" flags — so
 * scrubbing `t` backwards runs the whole sequence backwards, exactly.
 *
 * `t` is pipeline-local progress (0 = camera still inside the room, 1 = pulled
 * all the way back with the outputs lit). `elapsed` is wall-clock seconds since
 * the scene started, and only the particles and the idle drift read it, so the
 * picture stays alive when the reader stops scrolling.
 */
import * as THREE from 'three';
export interface PipelineParts {
    /** Added to the scene by the caller. */
    readonly root: THREE.Group;
    /**
     * @param t        pipeline-local progress, 0 = camera still in the room,
     *                 1 = fully pulled back with the outputs lit. Already clamped.
     * @param elapsed  seconds since scene start, for time-based motion.
     */
    update(t: number, elapsed: number): void;
    /** Everything the caller must dispose. */
    readonly materials: readonly THREE.Material[];
    readonly geometries: readonly THREE.BufferGeometry[];
}
export interface LabelStyle {
    /** Sprite width in world units. Height follows the 4:1 canvas. Default 4. */
    readonly size?: number;
    /** Text colour. Default `COLORS.ink`. */
    readonly color?: string;
    /** Font weight painted into the canvas. Default 500. */
    readonly weight?: number;
    /** Font size in canvas pixels on a 512×128 canvas. Default 56. */
    readonly fontPx?: number;
    /** Chip fill behind the text, or undefined for text alone. */
    readonly fill?: string;
    /** Chip border. */
    readonly border?: string;
}
/**
 * A billboarded text sprite, starting fully opaque at the origin.
 *
 * Exported because the tour needs the same label treatment inside the room and
 * outside it, and two implementations of "text that does not skew" is one too
 * many. **Disposal:** the sprite's geometry belongs to three.js and is shared,
 * so there is nothing to free there; the caller disposes
 * `sprite.material`, and that call also frees the canvas texture behind it
 * (`dispose` is wrapped here to do both). Labels built inside `buildPipeline`
 * are already in the returned `materials` array — only labels you create
 * yourself are yours to dispose.
 */
export declare function pipelineLabel(text: string, opts?: LabelStyle): THREE.Sprite;
export declare function buildPipeline(): PipelineParts;
//# sourceMappingURL=tour-pipeline.d.ts.map