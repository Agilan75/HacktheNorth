/**
 * The Federato resource graph, as the planner walks it — the authored geometry
 * and the transcribed numbers behind the `#agent` scene on `/tour`.
 *
 * Nothing here is fetched. The layout is authored so the scene looks identical
 * on every run (a force sim would be novel and useless), but every path, count,
 * label and duration is transcribed from the recorded ingest run: the same
 * numbers the prose panels beside it already state, and the same
 * `pathChosen.path` / `alternativesRejected` / `durationMs` the stored
 * `QueryTraceEntry` carries. If the recorded run changes, these change with it.
 *
 * `tour-agent.ts` owns pixels; this file owns what is true.
 */
import * as THREE from 'three';
/** The seven resources the planner actually touches on this dataset. */
export declare const NODE_IDS: readonly ["submission", "policy", "insured", "claim", "exposureUnit", "location", "building"];
export type NodeId = (typeof NODE_IDS)[number];
export interface GraphNode {
    readonly id: NodeId;
    /** The resource name as Federato spells it. */
    readonly label: string;
    /** The field on the parent that reaches it, or null for the root. */
    readonly via: string | null;
    readonly at: THREE.Vector3;
}
/**
 * Laid out left to right in the order the deep pass expands them, with the two
 * leaf branches (insured, claims) thrown off Policy above and below so the
 * spine — submission → policy → exposure_units → location → buildings — reads
 * as one straight run. Depth (z) is small and only there to give the camera
 * something to parallax against.
 */
export declare const NODES: readonly GraphNode[];
export declare const NODE_BY_ID: Readonly<Record<NodeId, GraphNode>>;
export declare const EDGE_IDS: readonly ["submission-policy", "policy-insured", "policy-claim", "policy-exposure", "exposure-location", "location-building"];
export type EdgeId = (typeof EDGE_IDS)[number];
export interface GraphEdge {
    readonly id: EdgeId;
    readonly from: NodeId;
    readonly to: NodeId;
    /** The field name on `from` that reaches `to`. */
    readonly field: string;
}
export declare const EDGES: readonly GraphEdge[];
/**
 * The path the deep pass actually took, from the stored trace's
 * `pathChosen.path`: `["exposure_units", "location", "buildings"]`, rooted at
 * Policy. Drawn as the taken path — red marks the route, never a failure.
 */
export declare const DEEP_PATH: readonly EdgeId[];
/** The rest of the one deep query's expand tree, lit with it but not the spine. */
export declare const DEEP_BRANCHES: readonly EdgeId[];
/** One per `<Panel>` in `AgentGroup`, in the order they appear. */
export declare const STEP_IDS: readonly ["read", "locate", "triage", "deep", "adapt", "trace"];
export type StepId = (typeof STEP_IDS)[number];
/**
 * How long each step holds, in the same seconds the scene's timing table uses
 * (so `PACE` in `tour-agent.ts` stretches these with everything else).
 *
 * Each is its beat's own length plus a rest of about a third of a second — no
 * more. The first cut gave every step a second or more of dead air at the end,
 * which read as the film hesitating between one resource and the next. The
 * time went back into the beats instead: slower moves, tighter joins.
 *
 * The scene plays these once, end to end, at a constant speed and then holds
 * on the last frame. It is not scrubbed by scroll position and it does not
 * loop — a demo that restarts behind you is a distraction, not a feature.
 */
export declare const STEP_SECONDS: Readonly<Record<StepId, number>>;
/** Cumulative start time of each step, and the total length of one pass. */
export declare const STEP_STARTS: Readonly<Record<StepId, number>>;
export declare const TIMELINE_SECONDS: number;
/**
 * Which step is playing at `t` seconds into the timeline, and how far into it.
 * Clamped at both ends rather than wrapped: past the last step this keeps
 * returning the last step, so the film ends on its final frame and stays there.
 */
export declare function stepAt(t: number): {
    readonly step: StepId;
    readonly age: number;
};
export interface StepPose {
    readonly eye: THREE.Vector3;
    readonly look: THREE.Vector3;
}
/**
 * Where the camera sits for each step. Eased between, never cut: opening a
 * panel three steps down should fly, so the graph stays one continuous place
 * rather than six unrelated pictures.
 *
 * The sequence reads left to right. Steps 1, 2 and 6 are wide shots, which are
 * neutral — moving between a wide shot and a close one is a push in or a pull
 * back, not a lateral jump. The three close shots then run one way along the
 * spine and never double back: triage at the root (x ≈ 0), the deep pass at
 * Policy (x ≈ 10), the adaptation out at Location (x ≈ 18). Putting a close
 * shot out of that order is what made the first cut feel like it was pacing.
 */
export declare const POSES: Readonly<Record<StepId, StepPose>>;
/**
 * Triage, from the stored trace: one query over all 158 submissions for id,
 * status and line of business; 120 knocked out on line of business, each citing
 * the rule that did it.
 */
export declare const TRIAGE: {
    readonly total: 158;
    readonly kept: 38;
    readonly dropped: 120;
};
/** The deep pass: one `Policy` query, all 27 property policies fully hydrated. */
export declare const DEEP: {
    readonly policies: 27;
};
/**
 * The adaptation, verbatim from the trace: a dot-path through an array silently
 * matches nothing on the live handler, and the `$elemMatch` form matches 47.
 * `adaptation: 'elem_match_swap'`.
 */
export declare const ADAPT: {
    readonly before: "exposure_units.location.state: CA";
    readonly beforeRows: 0;
    readonly after: "$elemMatch";
    readonly afterRows: 47;
};
/**
 * The one field the synonym table cannot place: building-level protection
 * class, which Federato stores on the location. It stays visibly unmapped on
 * `Building` and is found by walking to `Location` — the step-2 probe.
 */
export declare const UNMAPPED: {
    readonly field: "protection class";
    readonly missesOn: "building";
    readonly foundOn: "location";
};
/**
 * The four recorded queries, in order, with their real `durationMs`. Used two
 * ways: the relative length of each pulse in step 6, and the labels laid along
 * the wires. They sum to ~6.2 s of query time inside the 9.2 s seed wall clock,
 * which is why the section's figure tiles say what they say.
 */
export interface RecordedQuery {
    readonly pass: string;
    readonly label: string;
    readonly rowCount: number;
    readonly durationMs: number;
    readonly along: readonly EdgeId[];
}
export declare const RECORDED: readonly RecordedQuery[];
/** The slowest recorded query, so pulse lengths can be expressed relative to it. */
export declare const SLOWEST_MS: number;
/**
 * Why `Submission` was rejected as the deep pass's root, from the trace's
 * `alternativesRejected`. Drawn dashed and sage, then faded — a road not taken,
 * not an error.
 */
export declare const REJECTED_ROOT: {
    readonly resource: "Submission";
    readonly why: "no premium, TIV or building fields";
};
/**
 * Every edge is a shallow arc rather than a straight segment: three hairlines
 * meeting at a node read as a diagram, three straight ones read as a crash.
 * The bow is perpendicular-ish to the run and scales with its length.
 */
export declare function edgeCurve(edge: GraphEdge): THREE.QuadraticBezierCurve3;
/** How many samples each edge is drawn with. Also the draw-range denominator. */
export declare const EDGE_SAMPLES = 64;
export declare function edgePoints(edge: GraphEdge): readonly THREE.Vector3[];
/** A point at `u` (0..1) along an edge, written into `out`. */
export declare function edgePointAt(edge: GraphEdge, u: number, out: THREE.Vector3): THREE.Vector3;
//# sourceMappingURL=tour-agent-graph.d.ts.map