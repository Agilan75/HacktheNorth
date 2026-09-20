/**
 * The three.js side of /explore: one renderer, one camera, orbit controls, and
 * a node set rebuilt whenever the rows or the mode change. Two layouts:
 *
 * - scatter: appetite (x) × pricing adequacy (y) × log TIV (z). Rows with no
 *   price sit on a "no price" floor under the chart; rows with no TIV at the
 *   back wall.
 * - network: submissions linked to hub nodes (underwriter, state, line,
 *   verdict), laid out once by a small force simulation, then frozen.
 *
 * Every number shown comes from the API row; nothing here computes a score.
 */
import * as THREE from 'three';
import type { QueueRowView } from '../panels/types.js';
export type ExploreMode = 'scatter' | 'network';
export type HubKind = 'underwriter' | 'state' | 'line' | 'verdict';
export interface HoverInfo {
    readonly kind: 'row';
    readonly row: QueueRowView;
    readonly x: number;
    readonly y: number;
}
export interface HubHoverInfo {
    readonly kind: 'hub';
    readonly hubKind: HubKind;
    readonly label: string;
    readonly count: number;
    readonly x: number;
    readonly y: number;
}
export interface SceneCallbacks {
    readonly onHover: (info: HoverInfo | HubHoverInfo | null) => void;
    readonly onOpen: (row: QueueRowView) => void;
}
export declare function scatterPosition(row: QueueRowView): THREE.Vector3;
export declare function textSprite(text: string, opts?: {
    size?: number;
    color?: string;
    weight?: number;
}): THREE.Sprite;
export declare function line(points: readonly THREE.Vector3[], color: string, opacity?: number): THREE.Line;
export interface ExploreScene {
    setData(rows: readonly QueueRowView[], mode: ExploreMode): void;
    resetView(): void;
    dispose(): void;
}
export declare function webglAvailable(): boolean;
export declare function createExploreScene(host: HTMLElement, callbacks: SceneCallbacks): ExploreScene;
//# sourceMappingURL=explore-scene.d.ts.map