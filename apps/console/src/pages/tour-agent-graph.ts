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

/* -------------------------------------------------------------------------- */
/* Nodes                                                                      */
/* -------------------------------------------------------------------------- */

/** The seven resources the planner actually touches on this dataset. */
export const NODE_IDS = [
  'submission',
  'policy',
  'insured',
  'claim',
  'exposureUnit',
  'location',
  'building',
] as const;

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
export const NODES: readonly GraphNode[] = [
  { id: 'submission', label: 'Submission', via: null, at: new THREE.Vector3(0, 0, 0) },
  { id: 'policy', label: 'Policy', via: 'policy', at: new THREE.Vector3(6.2, 0.2, -0.8) },
  { id: 'insured', label: 'Insured', via: 'insured', at: new THREE.Vector3(9.4, 3.4, 1.4) },
  { id: 'claim', label: 'Claim', via: 'claims', at: new THREE.Vector3(9.4, -3.2, 1.1) },
  {
    id: 'exposureUnit',
    label: 'ExposureUnit',
    via: 'exposure_units',
    at: new THREE.Vector3(12.4, 0.5, -2.1),
  },
  { id: 'location', label: 'Location', via: 'location', at: new THREE.Vector3(16.4, 1.5, -0.6) },
  { id: 'building', label: 'Building', via: 'buildings', at: new THREE.Vector3(19.8, -1.1, 1.3) },
];

export const NODE_BY_ID: Readonly<Record<NodeId, GraphNode>> = Object.fromEntries(
  NODES.map((n) => [n.id, n]),
) as Record<NodeId, GraphNode>;

/* -------------------------------------------------------------------------- */
/* Edges                                                                      */
/* -------------------------------------------------------------------------- */

export const EDGE_IDS = [
  'submission-policy',
  'policy-insured',
  'policy-claim',
  'policy-exposure',
  'exposure-location',
  'location-building',
] as const;

export type EdgeId = (typeof EDGE_IDS)[number];

export interface GraphEdge {
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
  /** The field name on `from` that reaches `to`. */
  readonly field: string;
}

export const EDGES: readonly GraphEdge[] = [
  { id: 'submission-policy', from: 'submission', to: 'policy', field: 'policy' },
  { id: 'policy-insured', from: 'policy', to: 'insured', field: 'insured' },
  { id: 'policy-claim', from: 'policy', to: 'claim', field: 'claims' },
  { id: 'policy-exposure', from: 'policy', to: 'exposureUnit', field: 'exposure_units' },
  { id: 'exposure-location', from: 'exposureUnit', to: 'location', field: 'location' },
  { id: 'location-building', from: 'location', to: 'building', field: 'buildings' },
];

/**
 * The path the deep pass actually took, from the stored trace's
 * `pathChosen.path`: `["exposure_units", "location", "buildings"]`, rooted at
 * Policy. Drawn as the taken path — red marks the route, never a failure.
 */
export const DEEP_PATH: readonly EdgeId[] = [
  'policy-exposure',
  'exposure-location',
  'location-building',
];

/** The rest of the one deep query's expand tree, lit with it but not the spine. */
export const DEEP_BRANCHES: readonly EdgeId[] = ['policy-insured', 'policy-claim'];

/* -------------------------------------------------------------------------- */
/* The six steps                                                              */
/* -------------------------------------------------------------------------- */

/** One per `<Panel>` in `AgentGroup`, in the order they appear. */
export const STEP_IDS = ['read', 'locate', 'triage', 'deep', 'adapt', 'trace'] as const;

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
export const STEP_SECONDS: Readonly<Record<StepId, number>> = {
  // readStroke 1.6
  read: 2.0,
  // sweep 1.3 + miss 1.0 + 0.2 + walk 1.2 = 3.7
  locate: 4.0,
  // 0.35 + pulse 0.9 + fade 1.1 = 2.35
  triage: 2.7,
  // rejectIn 0.7 + hold 1.5 + out 0.9 = 3.1, which outlasts the 2.1 stroke
  deep: 3.4,
  // 0.2 + fail 1.3 + gap 0.45 + ok 1.4 = 3.35
  adapt: 3.6,
  // traceCycle 4.2, played once: the four paths end up lit together and stay
  // that way, which is the picture the whole thing was building toward.
  trace: 4.4,
};

/** Cumulative start time of each step, and the total length of one pass. */
export const STEP_STARTS: Readonly<Record<StepId, number>> = (() => {
  const starts: Partial<Record<StepId, number>> = {};
  let at = 0;
  for (const id of STEP_IDS) {
    starts[id] = at;
    at += STEP_SECONDS[id];
  }
  return starts as Record<StepId, number>;
})();

export const TIMELINE_SECONDS = STEP_IDS.reduce((sum, id) => sum + STEP_SECONDS[id], 0);

/**
 * Which step is playing at `t` seconds into the timeline, and how far into it.
 * Clamped at both ends rather than wrapped: past the last step this keeps
 * returning the last step, so the film ends on its final frame and stays there.
 */
export function stepAt(t: number): { readonly step: StepId; readonly age: number } {
  const clamped = t < 0 ? 0 : t > TIMELINE_SECONDS ? TIMELINE_SECONDS : t;
  let at = 0;
  for (const id of STEP_IDS) {
    const next = at + STEP_SECONDS[id];
    if (clamped < next) return { step: id, age: clamped - at };
    at = next;
  }
  const last = STEP_IDS[STEP_IDS.length - 1] ?? STEP_IDS[0];
  return { step: last, age: STEP_SECONDS[last] };
}

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
export const POSES: Readonly<Record<StepId, StepPose>> = {
  // The whole graph, drawing itself out of the root.
  read: { eye: new THREE.Vector3(8.6, 4.2, 26.0), look: new THREE.Vector3(9.4, 0.1, -0.4) },
  // Still wide: the fields are collected across the whole graph, left to
  // right, and the one the table cannot place misses at the far end.
  locate: { eye: new THREE.Vector3(10.4, 3.4, 21.0), look: new THREE.Vector3(11.6, 0.2, -0.3) },
  // Down onto the root, beside the 158 tick marks.
  triage: { eye: new THREE.Vector3(-2.6, 1.1, 10.5), look: new THREE.Vector3(-0.6, 0.3, -0.4) },
  // Policy, with the expand tree opening off it.
  deep: { eye: new THREE.Vector3(10.2, 2.4, 13.5), look: new THREE.Vector3(11.4, 0.1, -1.0) },
  // The dot-path that matches nothing, then the one that matches 47.
  adapt: { eye: new THREE.Vector3(17.8, 1.5, 9.0), look: new THREE.Vector3(18.2, -0.2, 0.2) },
  // Everything at once, as one wire diagram.
  trace: { eye: new THREE.Vector3(9.5, 7.4, 33.0), look: new THREE.Vector3(9.6, 0.0, -1.0) },
};

/* -------------------------------------------------------------------------- */
/* The transcribed run                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Triage, from the stored trace: one query over all 158 submissions for id,
 * status and line of business; 120 knocked out on line of business, each citing
 * the rule that did it.
 */
export const TRIAGE = { total: 158, kept: 38, dropped: 120 } as const;

/** The deep pass: one `Policy` query, all 27 property policies fully hydrated. */
export const DEEP = { policies: 27 } as const;

/**
 * The adaptation, verbatim from the trace: a dot-path through an array silently
 * matches nothing on the live handler, and the `$elemMatch` form matches 47.
 * `adaptation: 'elem_match_swap'`.
 */
export const ADAPT = {
  before: 'exposure_units.location.state: CA',
  beforeRows: 0,
  after: '$elemMatch',
  afterRows: 47,
} as const;

/**
 * The one field the synonym table cannot place: building-level protection
 * class, which Federato stores on the location. It stays visibly unmapped on
 * `Building` and is found by walking to `Location` — the step-2 probe.
 */
export const UNMAPPED = { field: 'protection class', missesOn: 'building', foundOn: 'location' } as const;

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

export const RECORDED: readonly RecordedQuery[] = [
  {
    pass: 'triage',
    label: 'triage',
    rowCount: 158,
    durationMs: 1718,
    along: ['submission-policy'],
  },
  {
    pass: 'deep',
    label: 'deep pass',
    rowCount: 27,
    durationMs: 2254,
    along: ['policy-exposure', 'exposure-location', 'location-building'],
  },
  {
    pass: 'no_policy_followup',
    label: 'no-policy follow-up',
    rowCount: 11,
    durationMs: 1135,
    along: ['submission-policy'],
  },
  {
    pass: 'high_scorer_followup',
    label: 'high-scorer follow-up',
    rowCount: 1,
    durationMs: 1102,
    along: ['policy-claim'],
  },
];

/** The slowest recorded query, so pulse lengths can be expressed relative to it. */
export const SLOWEST_MS = RECORDED.reduce((max, q) => Math.max(max, q.durationMs), 0);

/**
 * Why `Submission` was rejected as the deep pass's root, from the trace's
 * `alternativesRejected`. Drawn dashed and sage, then faded — a road not taken,
 * not an error.
 */
export const REJECTED_ROOT = {
  resource: 'Submission',
  why: 'no premium, TIV or building fields',
} as const;

/* -------------------------------------------------------------------------- */
/* Curves                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every edge is a shallow arc rather than a straight segment: three hairlines
 * meeting at a node read as a diagram, three straight ones read as a crash.
 * The bow is perpendicular-ish to the run and scales with its length.
 */
export function edgeCurve(edge: GraphEdge): THREE.QuadraticBezierCurve3 {
  const a = NODE_BY_ID[edge.from].at;
  const b = NODE_BY_ID[edge.to].at;
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const run = new THREE.Vector3().subVectors(b, a);
  // Bow within the xy plane, away from the spine, proportional to the span.
  const bow = new THREE.Vector3(-run.y, run.x, 0).normalize().multiplyScalar(run.length() * 0.09);
  return new THREE.QuadraticBezierCurve3(a.clone(), mid.add(bow), b.clone());
}

/** Points along an edge, cached per edge id so every consumer shares one sampling. */
const POINTS = new Map<EdgeId, readonly THREE.Vector3[]>();

/** How many samples each edge is drawn with. Also the draw-range denominator. */
export const EDGE_SAMPLES = 64;

export function edgePoints(edge: GraphEdge): readonly THREE.Vector3[] {
  const cached = POINTS.get(edge.id);
  if (cached) return cached;
  const pts = edgeCurve(edge).getPoints(EDGE_SAMPLES - 1);
  POINTS.set(edge.id, pts);
  return pts;
}

/** A point at `u` (0..1) along an edge, written into `out`. */
export function edgePointAt(edge: GraphEdge, u: number, out: THREE.Vector3): THREE.Vector3 {
  const pts = edgePoints(edge);
  const span = (pts.length - 1) * (u < 0 ? 0 : u > 1 ? 1 : u);
  const i = Math.max(0, Math.min(pts.length - 2, Math.floor(span)));
  const a = pts[i];
  const b = pts[i + 1];
  // Only reachable on a degenerate curve; a sampled edge always has >= 2 points.
  if (!a || !b) return out.copy(NODE_BY_ID[edge.to].at);
  return out.lerpVectors(a, b, span - i);
}
