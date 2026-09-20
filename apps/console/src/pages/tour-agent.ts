/**
 * The Federato agent, drawn: the resource graph as an ink blueprint, and the
 * planner walking it one step at a time.
 *
 * This is the same contract as `tour-house.ts` — the page owns state and
 * scroll, this module owns pixels, React never sees a frame. The page reports
 * which of the six `<Panel>`s is open via `setStep`; the camera eases to that
 * step's pose and the graph plays that step's beat on a wall clock.
 *
 * Colour carries meaning and is not decorative. Ink hairlines are the schema.
 * Red is the path the planner *took* — never a failure, per the house rule that
 * red never means bad. Sage dashes are roads not taken: rejected alternatives,
 * probes, knocked-out rows. A query that comes back empty is shown by going
 * unlit and returning nothing, which is what actually happened.
 *
 * Everything is `LineBasicMaterial` hairlines and billboarded flat discs: at
 * any device pixel ratio a WebGL line is exactly one pixel wide, which is the
 * drafting-table look we want and also the cheapest thing to draw. No lights,
 * no shadows, no post-processing — the whole scene is unlit basic materials.
 */
import * as THREE from 'three';

import { COLORS } from '@retrofit/design';

import {
  ADAPT,
  DEEP,
  DEEP_BRANCHES,
  DEEP_PATH,
  EDGES,
  EDGE_SAMPLES,
  NODES,
  NODE_BY_ID,
  NODE_IDS,
  POSES,
  RECORDED,
  SLOWEST_MS,
  STEP_IDS,
  STEP_STARTS,
  TIMELINE_SECONDS,
  TRIAGE,
  UNMAPPED,
  edgePointAt,
  edgePoints,
  stepAt,
} from './tour-agent-graph.js';
import type { EdgeId, GraphEdge, NodeId, StepId } from './tour-agent-graph.js';

/* -------------------------------------------------------------------------- */
/* Badges                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The DOM elements the scene positions: one per node for its resource name,
 * plus a single readout whose text the page sets per step and whose anchor
 * moves with the step. Labels are DOM rather than sprites so they render in
 * real Fraunces at real hinting, the way the rest of the page does.
 */
export const BADGE_IDS = [...NODE_IDS, 'readout'] as const;

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

/* -------------------------------------------------------------------------- */
/* Timing                                                                     */
/* -------------------------------------------------------------------------- */

/** Seconds, per step, measured from the moment the step became the target. */
const T = {
  readStroke: 1.6,
  /** The left-to-right pass that marks every resource a field is taken from. */
  locateSweep: 1.3,
  locateMiss: 1.0,
  locateWalk: 1.2,
  triagePulse: 0.9,
  triageFade: 1.1,
  deepStroke: 1.9,
  rejectIn: 0.7,
  rejectHold: 1.5,
  rejectOut: 0.9,
  adaptFail: 1.3,
  adaptGap: 0.45,
  adaptOk: 1.4,
  /** Step 6 loops: one full cycle of all four recorded queries. */
  traceCycle: 4.2,
} as const;

/** Longest beat in any step; past it the scene is static and stops redrawing. */
const SETTLE = 5.0;

/**
 * Wall-clock seconds per second of the table above — the one tempo knob.
 * Raise it to slow every beat at once and keep their relative rhythm intact,
 * including the recorded durations driving the step-6 pulses. The table is
 * written at 1.0 so the numbers in it stay readable as what they are.
 *
 * Below 1.0 the film runs faster than the table reads. At 0.45 one pass is
 * about nine seconds — a shade over three times the first cut's speed.
 */
const PACE = 0.45;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number): number => t * t * (3 - 2 * t);

/** 0 before `from`, 1 after `to`, eased between. Seconds in, unit out. */
function phase(age: number, from: number, to: number): number {
  return to <= from ? (age >= to ? 1 : 0) : ease(clamp01((age - from) / (to - from)));
}

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

interface Kit {
  readonly materials: THREE.Material[];
  readonly geometries: THREE.BufferGeometry[];
}

function line(
  kit: Kit,
  points: readonly THREE.Vector3[],
  color: string,
  opacity: number,
  dashed = false,
): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([...points]);
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.22, gapSize: 0.16 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const l = new THREE.Line(geometry, material);
  if (dashed) l.computeLineDistances();
  kit.geometries.push(geometry);
  kit.materials.push(material);
  return l;
}

function disc(kit: Kit, radius: number, color: string, opacity: number): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(radius, 40);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
  kit.geometries.push(geometry);
  kit.materials.push(material);
  return new THREE.Mesh(geometry, material);
}

function ring(
  kit: Kit,
  inner: number,
  outer: number,
  color: string,
  opacity: number,
): THREE.Mesh {
  const geometry = new THREE.RingGeometry(inner, outer, 44);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
  });
  kit.geometries.push(geometry);
  kit.materials.push(material);
  return new THREE.Mesh(geometry, material);
}

/** Set a line's material opacity without reaching through `as` casts at call sites. */
function setOpacity(object: THREE.Line | THREE.Mesh, opacity: number): void {
  const material = object.material;
  if (!Array.isArray(material)) material.opacity = opacity;
  object.visible = opacity > 0.004;
}

/** Reveal the first `t` (0..1) of a sampled line, as if it were being drawn. */
function drawTo(l: THREE.Line, t: number): void {
  const count = Math.max(0, Math.min(EDGE_SAMPLES, Math.ceil(EDGE_SAMPLES * clamp01(t))));
  l.geometry.setDrawRange(0, count < 2 ? 0 : count);
}

/* -------------------------------------------------------------------------- */
/* The scene                                                                  */
/* -------------------------------------------------------------------------- */

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

export function createAgentScene(host: HTMLElement, options: AgentSceneOptions): AgentScene {
  const { reducedMotion, onStep, onEnd } = options;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  const kit: Kit = { materials: [], geometries: [] };
  const root = new THREE.Group();
  scene.add(root);

  /* -- the schema itself: ink hairlines and node marks --------------------- */

  const edgeById = new Map<EdgeId, GraphEdge>(EDGES.map((e) => [e.id, e]));
  const inkLines = new Map<EdgeId, THREE.Line>();
  const pathLines = new Map<EdgeId, THREE.Line>();

  for (const edge of EDGES) {
    const points = edgePoints(edge);
    const ink = line(kit, points, COLORS.ink, 0.55);
    inkLines.set(edge.id, ink);
    root.add(ink);
    // The red overlay sits a hair in front so it never z-fights the ink.
    const taken = line(kit, points, COLORS.red, 0.95);
    taken.position.z = 0.012;
    drawTo(taken, 0);
    pathLines.set(edge.id, taken);
    root.add(taken);
  }

  /** Billboarded marks, re-oriented to face the camera every frame. */
  const billboards: THREE.Mesh[] = [];
  const nodeFill = new Map<NodeId, THREE.Mesh>();
  const nodeRing = new Map<NodeId, THREE.Mesh>();
  const nodeMark = new Map<NodeId, THREE.Mesh>();

  for (const node of NODES) {
    const fill = disc(kit, 0.34, COLORS.paper, 1);
    fill.position.copy(node.at);
    const edge = ring(kit, 0.34, 0.4, COLORS.ink, 0.85);
    edge.position.copy(node.at);
    edge.position.z += 0.004;
    // The "found / in play" mark: a red ring that only lights when a query
    // actually lands on this resource.
    const mark = ring(kit, 0.46, 0.54, COLORS.red, 0);
    mark.position.copy(node.at);
    mark.position.z += 0.008;
    nodeFill.set(node.id, fill);
    nodeRing.set(node.id, edge);
    nodeMark.set(node.id, mark);
    billboards.push(fill, edge, mark);
    root.add(fill, edge, mark);
  }

  /* -- step 2: the probe that misses, then walks --------------------------- */

  const buildingAt = NODE_BY_ID[UNMAPPED.missesOn as NodeId].at;
  const probeStub = line(
    kit,
    [buildingAt.clone(), buildingAt.clone().add(new THREE.Vector3(2.6, -1.5, 0.4))],
    COLORS.muted,
    0,
    true,
  );
  root.add(probeStub);

  const walkEdge = edgeById.get('location-building');
  const walkPoints = walkEdge ? [...edgePoints(walkEdge)].reverse() : [];
  const probeWalk = line(kit, walkPoints, COLORS.muted, 0, true);
  probeWalk.position.z = 0.008;
  root.add(probeWalk);

  /* -- step 3: 158 rows, 120 of which go out ------------------------------- */

  const TICK_COLS = 12;
  const tickGeometry = new THREE.PlaneGeometry(0.2, 0.26);
  const tickMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
  kit.geometries.push(tickGeometry);
  kit.materials.push(tickMaterial);
  const ticks = new THREE.InstancedMesh(tickGeometry, tickMaterial, TRIAGE.total);
  ticks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  {
    const m = new THREE.Matrix4();
    for (let i = 0; i < TRIAGE.total; i += 1) {
      const col = i % TICK_COLS;
      const row = Math.floor(i / TICK_COLS);
      m.makeTranslation(-4.6 + col * 0.3, 2.0 - row * 0.32, 0);
      ticks.setMatrixAt(i, m);
      ticks.setColorAt(i, new THREE.Color(COLORS.ink));
    }
    ticks.instanceMatrix.needsUpdate = true;
    if (ticks.instanceColor) ticks.instanceColor.needsUpdate = true;
  }
  // The grid is authored in the mesh's local xy plane, so billboarding the
  // whole InstancedMesh keeps every tick facing the camera.
  ticks.position.copy(NODE_BY_ID.submission.at).add(new THREE.Vector3(0, 0, 0.5));
  root.add(ticks);
  billboards.push(ticks);

  /* -- step 4: the root that was rejected ---------------------------------- */

  const submissionAt = NODE_BY_ID.submission.at;
  const rejectLine = line(
    kit,
    [NODE_BY_ID.policy.at.clone(), submissionAt.clone()],
    COLORS.muted,
    0,
    true,
  );
  rejectLine.position.z = 0.016;
  root.add(rejectLine);

  /* -- the travelling query pulse ------------------------------------------ */

  const pulse = disc(kit, 0.17, COLORS.red, 0);
  root.add(pulse);
  billboards.push(pulse);

  /* -- badges -------------------------------------------------------------- */

  const badges = new Map<BadgeId, HTMLElement>();
  /** Where each badge hangs this frame. Node badges are fixed; readout moves. */
  const readoutAt = new THREE.Vector3();
  const badgeOpacity = new Map<BadgeId, number>();

  /* -- state --------------------------------------------------------------- */

  // One clock for the whole film, in timing-table seconds. Everything else —
  // which step is on, how far into its beat, where the camera is heading — is
  // derived from it, so the picture and the step the page highlights can never
  // disagree with each other.
  let elapsed = 0;
  let lastFrame = performance.now();
  let playedStep: StepId = STEP_IDS[0];
  let targetIndex = 0;
  let currentIndex = 0;
  let active = false;
  let settled = false;
  let ended = false;
  let disposed = false;
  let width = 1;
  let height = 1;
  let raf = 0;

  const eye = new THREE.Vector3().copy(POSES[STEP_IDS[0]].eye);
  const look = new THREE.Vector3().copy(POSES[STEP_IDS[0]].look);
  const scratch = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const camSpace = new THREE.Vector3();

  function resize(): void {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // A resize invalidates the held final frame: without this the canvas keeps
    // the old buffer at the new size once the film has settled.
    settled = false;
  }

  /* -- per-step choreography ----------------------------------------------- */

  /**
   * Stroke a sequence of edges as one continuous run: `t` spans the whole path,
   * each edge lighting in turn. Returns the edge and local position of the head,
   * so the pulse can ride it.
   */
  function strokePath(
    edges: readonly EdgeId[],
    t: number,
    opacity = 1,
  ): { edge: GraphEdge; u: number } | null {
    const span = clamp01(t) * edges.length;
    let head: { edge: GraphEdge; u: number } | null = null;
    for (let i = 0; i < edges.length; i += 1) {
      const id = edges[i];
      if (!id) continue;
      const l = pathLines.get(id);
      const edge = edgeById.get(id);
      if (!l || !edge) continue;
      const local = clamp01(span - i);
      drawTo(l, local);
      setOpacity(l, local > 0 ? opacity : 0);
      if (local > 0 && local < 1) head = { edge, u: local };
      else if (local >= 1 && i === edges.length - 1) head = { edge, u: 1 };
    }
    return head;
  }

  function clearPaths(): void {
    for (const l of pathLines.values()) {
      drawTo(l, 0);
      setOpacity(l, 0);
    }
  }

  function clearMarks(): void {
    for (const m of nodeMark.values()) setOpacity(m, 0);
  }

  function markNode(id: NodeId, opacity: number): void {
    const m = nodeMark.get(id);
    if (m) setOpacity(m, opacity);
  }

  function setPulse(edge: GraphEdge | null, u: number, opacity: number): void {
    if (!edge || opacity <= 0.004) {
      setOpacity(pulse, 0);
      return;
    }
    edgePointAt(edge, u, scratch);
    pulse.position.copy(scratch);
    pulse.position.z += 0.02;
    setOpacity(pulse, opacity);
  }

  function tickColors(dropped: number): void {
    if (!ticks.instanceColor) return;
    const ink = new THREE.Color(COLORS.ink);
    const out = new THREE.Color(COLORS.mutedTint);
    for (let i = 0; i < TRIAGE.total; i += 1) {
      // The knocked-out rows are the last ones in the grid, so the survivors
      // read as a block rather than as noise.
      ticks.setColorAt(i, i >= TRIAGE.total - dropped ? out : ink);
    }
    ticks.instanceColor.needsUpdate = true;
  }

  /** Everything that is not this step's business, reset once per frame. */
  function resetTransient(): void {
    clearPaths();
    clearMarks();
    setOpacity(probeStub, 0);
    setOpacity(probeWalk, 0);
    setOpacity(rejectLine, 0);
    setOpacity(pulse, 0);
    tickMaterial.opacity = 0;
    ticks.visible = false;
    for (const id of BADGE_IDS) badgeOpacity.set(id, 1);
    badgeOpacity.set('readout', 0);
    readoutAt.copy(NODE_BY_ID.submission.at);
  }

  function choreograph(step: StepId, age: number): void {
    resetTransient();

    if (step === 'read') {
      // The schema being read in: hairlines drawn, nodes arriving behind them.
      const t = phase(age, 0, T.readStroke);
      let i = 0;
      for (const edge of EDGES) {
        const l = inkLines.get(edge.id);
        if (!l) continue;
        // Staggered so the graph unrolls from the root rather than blinking on.
        drawTo(l, clamp01(t * EDGES.length - i));
        i += 1;
      }
      for (let n = 0; n < NODES.length; n += 1) {
        const node = NODES[n];
        if (!node) continue;
        const o = phase(age, (n / NODES.length) * T.readStroke, T.readStroke);
        const fill = nodeFill.get(node.id);
        const edge = nodeRing.get(node.id);
        if (fill) setOpacity(fill, o);
        if (edge) setOpacity(edge, o * 0.85);
        badgeOpacity.set(node.id, o);
      }
      return;
    }

    // Past step 1 the schema is simply there.
    for (const l of inkLines.values()) drawTo(l, 1);
    for (const node of NODES) {
      const fill = nodeFill.get(node.id);
      const edge = nodeRing.get(node.id);
      if (fill) setOpacity(fill, 1);
      if (edge) setOpacity(edge, 0.85);
    }

    if (step === 'locate') {
      // Fields are collected off every resource, so the beat sweeps the spine
      // left to right — each node marked in turn — and only then does the one
      // field the synonym table cannot place probe Building, find nothing, and
      // walk to Location. The miss is the point: it stays visible rather than
      // being smoothed away.
      for (let n = 0; n < NODES.length; n += 1) {
        const node = NODES[n];
        if (!node) continue;
        const from = (n / NODES.length) * T.locateSweep;
        markNode(node.id, phase(age, from, from + 0.35) * 0.55);
      }

      const missAt = T.locateSweep;
      const missIn = phase(age, missAt, missAt + T.locateMiss * 0.5);
      const missOut = phase(age, missAt + T.locateMiss, missAt + T.locateMiss + 0.5);
      setOpacity(probeStub, missIn * (1 - missOut) * 0.9);

      const walkAt = missAt + T.locateMiss + 0.2;
      const walk = phase(age, walkAt, walkAt + T.locateWalk);
      drawTo(probeWalk, walk);
      setOpacity(probeWalk, walk > 0 ? 0.9 : 0);
      // Landing on Location brightens the dim sweep mark it already carries.
      // Only once the walk is under way, or Location would sit lit from the
      // first frame, before the sweep has even reached it.
      const landed = phase(age, walkAt + T.locateWalk - 0.3, walkAt + T.locateWalk);
      if (landed > 0) markNode('location', Math.max(0.55, landed));

      badgeOpacity.set('readout', phase(age, missAt, missAt + 0.6));
      readoutAt.copy(NODE_BY_ID.location.at);
      return;
    }

    if (step === 'triage') {
      // One query over all 158, and 120 go out on line of business.
      const arrive = phase(age, 0, 0.5);
      ticks.visible = arrive > 0.004;
      tickMaterial.opacity = arrive;
      const run = phase(age, 0.35, 0.35 + T.triagePulse);
      const edge = edgeById.get('submission-policy') ?? null;
      setPulse(edge, run, run > 0 && run < 1 ? 1 : 0);
      markNode('submission', arrive);
      const cut = phase(age, 0.35 + T.triagePulse, 0.35 + T.triagePulse + T.triageFade);
      tickColors(Math.round(TRIAGE.dropped * cut));
      badgeOpacity.set('readout', cut);
      readoutAt.copy(ticks.position).add(new THREE.Vector3(0, -2.6, 0));
      return;
    }

    if (step === 'deep') {
      // One Policy query, the whole expand tree, and the root that was not used.
      const t = phase(age, 0.2, 0.2 + T.deepStroke);
      const head = strokePath([...DEEP_PATH], t);
      strokePath([...DEEP_BRANCHES], phase(age, 0.5, 0.5 + T.deepStroke * 0.7), 0.7);
      setPulse(head?.edge ?? null, head?.u ?? 0, t > 0 && t < 1 ? 1 : 0);
      markNode('policy', phase(age, 0.1, 0.5));
      markNode('building', phase(age, 0.2 + T.deepStroke - 0.2, 0.2 + T.deepStroke + 0.2));
      const rin = phase(age, T.rejectIn, T.rejectIn + 0.5);
      const rout = phase(age, T.rejectIn + T.rejectHold, T.rejectIn + T.rejectHold + T.rejectOut);
      setOpacity(rejectLine, rin * (1 - rout) * 0.8);
      badgeOpacity.set('readout', phase(age, 0.4, 1.0));
      readoutAt.copy(NODE_BY_ID.policy.at).add(new THREE.Vector3(0, -1.5, 0));
      return;
    }

    if (step === 'adapt') {
      // The dot-path goes out and nothing comes back: the pulse dies partway
      // and the edge stays unlit. Then the clause is rewritten and the same
      // walk completes. Nothing turns red to mean "bad" — it simply fails to
      // arrive, which is what a zero-result query looks like.
      const path: readonly EdgeId[] = ['exposure-location', 'location-building'];
      const failing = phase(age, 0.2, 0.2 + T.adaptFail);
      const failEnd = 0.2 + T.adaptFail;
      const retryFrom = failEnd + T.adaptGap;
      const retry = phase(age, retryFrom, retryFrom + T.adaptOk);

      if (age < retryFrom) {
        // Out along the path, fading as it goes, arriving nowhere.
        const edge = edgeById.get('exposure-location') ?? null;
        setPulse(edge, failing * 0.8, (1 - failing) * 0.9);
        badgeOpacity.set('readout', phase(age, 0.4, 0.9));
      } else {
        const head = strokePath(path, retry);
        setPulse(head?.edge ?? null, head?.u ?? 0, retry > 0 && retry < 1 ? 1 : 0);
        markNode('building', phase(age, retryFrom + T.adaptOk - 0.3, retryFrom + T.adaptOk + 0.2));
        badgeOpacity.set('readout', 1);
      }
      markNode('exposureUnit', phase(age, 0.1, 0.5));
      readoutAt.copy(NODE_BY_ID.location.at).add(new THREE.Vector3(0, 1.4, 0));
      return;
    }

    // step === 'trace': all four recorded queries at once, each pulse as long
    // as that query really took. The whole chain, which is what the console
    // stores and shows as "How the agent got here".
    // One pass, not a cycle: the four paths light in their recorded order and
    // then stay lit. Looping here would restart the film's last shot forever.
    const cycle = reducedMotion ? 1 : clamp01(age / T.traceCycle);
    for (const q of RECORDED) {
      // Relative to the slowest query, so the rhythm on screen is the rhythm
      // that was recorded rather than an even beat.
      const span = q.durationMs / SLOWEST_MS;
      const local = clamp01(cycle / span);
      const head = strokePath(q.along, local, 0.85);
      if (q.pass === 'deep') setPulse(head?.edge ?? null, head?.u ?? 0, local < 1 ? 1 : 0);
    }
    for (const node of NODES) markNode(node.id, 0.5);
    badgeOpacity.set('readout', 1);
    readoutAt.copy(NODE_BY_ID.exposureUnit.at).add(new THREE.Vector3(0, 2.4, 0));
  }

  /* -- badge placement ------------------------------------------------------ */

  function placeBadges(): void {
    for (const id of BADGE_IDS) {
      const el = badges.get(id);
      if (!el) continue;
      const anchor = id === 'readout' ? readoutAt : NODE_BY_ID[id].at;
      const opacity = badgeOpacity.get(id) ?? 1;
      camSpace.copy(anchor).applyMatrix4(camera.matrixWorldInverse);
      if (opacity <= 0.004 || camSpace.z > -0.2) {
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
        continue;
      }
      projected.copy(anchor).project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      el.style.visibility = 'visible';
      el.style.opacity = String(opacity);
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }
  }

  /* -- frame ---------------------------------------------------------------- */

  function draw(): void {
    // The camera rides the step index, so opening a panel three steps down
    // flies there instead of cutting: the graph stays one continuous place.
    const lo = Math.max(0, Math.min(STEP_IDS.length - 1, Math.floor(currentIndex)));
    const hi = Math.min(STEP_IDS.length - 1, lo + 1);
    const frac = currentIndex - lo;
    const from = POSES[STEP_IDS[lo] ?? STEP_IDS[0]];
    const to = POSES[STEP_IDS[hi] ?? STEP_IDS[0]];
    eye.lerpVectors(from.eye, to.eye, frac);
    look.lerpVectors(from.look, to.look, frac);
    camera.position.copy(eye);
    camera.lookAt(look);
    camera.updateMatrixWorld();

    for (const b of billboards) b.quaternion.copy(camera.quaternion);

    choreograph(playedStep, reducedMotion ? SETTLE : stepAt(elapsed).age);

    renderer.render(scene, camera);
    placeBadges();
  }

  function tick(): void {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const wall = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!active) return;
    // Self-heal: the host is `display: none` until the page flips to `--live`,
    // and a ResizeObserver notification for that is not guaranteed to arrive.
    if (width <= 1 || height <= 1) resize();

    // A backgrounded tab hands back one enormous delta on return. Cap it, or
    // the film jumps several steps the moment the page is looked at again.
    if (!reducedMotion) {
      elapsed = Math.min(elapsed + Math.min(wall, 0.1) / PACE, TIMELINE_SECONDS);
    }

    const playing = stepAt(elapsed).step;
    if (playing !== playedStep) {
      playedStep = playing;
      targetIndex = STEP_IDS.indexOf(playing);
      onStep?.(playing);
    }

    const delta = targetIndex - currentIndex;
    const moving = Math.abs(delta) > 0.0004;
    if (moving) currentIndex += reducedMotion ? delta : delta * 0.12;
    else currentIndex = targetIndex;

    // Once the film has ended and the camera has stopped, the picture is
    // final. Draw it one more time and then leave the GPU alone — there is a
    // second scene on this page and no reason for both to spin.
    if (elapsed >= TIMELINE_SECONDS && !ended) {
      ended = true;
      onEnd?.();
    }

    const finished = elapsed >= TIMELINE_SECONDS && !moving;
    if (finished && settled) return;
    settled = finished;
    draw();
  }

  resize();
  const observer = new ResizeObserver(() => resize());
  observer.observe(host);
  raf = requestAnimationFrame(tick);
  // Announce the opening step immediately: the loop only reports transitions,
  // and the first step would otherwise go unhighlighted until it ended.
  onStep?.(playedStep);
  // Under reduced motion the clock never advances, so the end would never be
  // reached and the reader would be held in a pinned section by a still image.
  // There is nothing to wait for: let them straight out.
  if (reducedMotion) {
    ended = true;
    onEnd?.();
  }

  return {
    setStep(step: StepId): void {
      if (step === playedStep) return;
      // Scrubbing to a chapter: the film carries on from there rather than
      // treating the click as a separate mode.
      elapsed = STEP_STARTS[step];
      settled = false;
      playedStep = step;
      targetIndex = STEP_IDS.indexOf(step);
      onStep?.(step);
    },
    bindBadge(id: BadgeId, el: HTMLElement | null): void {
      if (el) badges.set(id, el);
      else badges.delete(id);
    },
    setActive(on: boolean): void {
      // Position is kept across a pause; only the frame clock is reset, so no
      // time accrues while the section is off screen.
      if (on && !active) {
        lastFrame = performance.now();
        settled = false;
      }
      active = on;
    },
    resize,
    dispose(): void {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(raf);
      ticks.dispose();
      for (const m of kit.materials) m.dispose();
      for (const g of kit.geometries) g.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    },
  };
}

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
export const READOUTS: Readonly<Record<StepId, { readonly label: string; readonly value: string }>> = {
  read: { label: 'The schema', value: `Read once, into a graph of ${NODES.length} resources.` },
  locate: {
    label: 'Protection class',
    value: 'Not on Building. Found on Location.',
  },
  triage: {
    label: 'Triage',
    value: `One query. ${TRIAGE.total} submissions, ${TRIAGE.kept} kept.`,
  },
  deep: {
    label: 'Deep pass',
    value: `One query. All ${DEEP.policies} property policies.`,
  },
  adapt: {
    label: 'Zero results',
    value: `The dot path matched ${ADAPT.beforeRows}. ${ADAPT.after} matched ${ADAPT.afterRows}.`,
  },
  trace: {
    label: 'The trace',
    value: `${RECORDED.length} queries, saved with every submission.`,
  },
};
