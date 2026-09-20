/**
 * The appetite terrain: the rules themselves, drawn as ground.
 *
 * The floor is TIV (x) by quoted premium (z), both on a log axis. The height of
 * each terrace is the appetite score the selected account would have if only
 * those two values moved — every other factor (state, building age,
 * construction, losses) stays exactly as that account has it. Terrace colour is
 * the verdict that ground produces, so the target band shows as a raised island
 * and the knockouts as dark lowlands with a hard cliff between them.
 *
 * Nothing here scores anything: the height is the account's own factor points
 * from the API, plus the two swept factors at the tier its band carries
 * (`appetite-bands.ts`, read from `GET /rules`).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COLORS, VERDICT_STYLES } from '@retrofit/design';

import type { Verdict } from '../panels/types.js';
import type { AppetiteBands, Band } from './appetite-bands.js';
import { bandAt } from './appetite-bands.js';
import { line, textSprite } from './explore-scene.js';

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/** One account's footprint on the floor: where it stands on the TIV/premium plane. */
export interface TerrainFootprint {
  readonly submissionId: string;
  readonly insuredName: string;
  readonly verdict: Verdict;
  readonly tiv: number | null;
  readonly premium: number | null;
  /** The engine's own sentence for this account, shown on hover: why it lands where it does. */
  readonly reason?: string | null;
  /** True for a row scored on another line of business (cyber, auto, ...), which these bands never applied to. */
  readonly otherLine?: boolean;
}

/** Everything the terrain needs about the account it is drawn for. */
export interface TerrainAccount extends TerrainFootprint {
  /** Appetite points from every factor except `tiv` and `total_premium`. */
  readonly basePoints: number;
  readonly tivWeight: number;
  readonly premiumWeight: number;
  /** A knockout on some other factor: no TIV or premium can rescue this ground. */
  readonly knockedOutElsewhere: boolean;
  /** Something other than these two factors forces a referral (missing data, a contradiction, a refer rule). */
  readonly refersElsewhere: boolean;
  /** The account's real score, for the pin label. */
  readonly appetiteScore: number;
}

export interface TerrainCell {
  readonly tivBand: Band;
  readonly premiumBand: Band;
  readonly score: number;
  readonly verdict: Verdict;
}

export interface TerrainHover {
  readonly kind: 'cell' | 'pin' | 'footprint';
  readonly cell?: TerrainCell;
  readonly footprint?: TerrainFootprint;
  readonly x: number;
  readonly y: number;
}

export interface TerrainCallbacks {
  readonly onHover: (info: TerrainHover | null) => void;
  readonly onSelect: (submissionId: string) => void;
  readonly onOpen: (submissionId: string) => void;
}

export interface TerrainScene {
  setData(account: TerrainAccount | null, footprints: readonly TerrainFootprint[], bands: AppetiteBands): void;
  resetView(): void;
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Axes                                                                       */
/* -------------------------------------------------------------------------- */

const HALF = 55;
const Y_TOP = 60;
const TIV_MIN = 5e6;
const TIV_MAX = 4e8;
const PREM_MIN = 2e4;
const PREM_MAX = 4e5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const axis = (v: number, lo: number, hi: number): number => {
  const t = (Math.log10(clamp(v, lo, hi)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  return t * 2 * HALF - HALF;
};
const xOf = (tiv: number): number => axis(tiv, TIV_MIN, TIV_MAX);
const zOf = (premium: number): number => axis(premium, PREM_MIN, PREM_MAX);
const yOf = (score: number): number => (clamp(score, 0, 100) / 100) * Y_TOP;

/** `$52,400,000` -> `$52M`, `$84,500` -> `$84k`. Edge labels have no room for full numbers. */
function shortMoney(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 1e9) return `$${Math.round(value / 1e8) / 10}B`;
  if (Math.abs(value) >= 1e6) return `$${Math.round(value / 1e5) / 10}M`;
  if (Math.abs(value) >= 1e3) return `$${Math.round(value / 100) / 10}k`;
  return `$${Math.round(value)}`;
}

export function bandLabel(band: Band): string {
  const from = Number.isFinite(band.from) ? shortMoney(band.from) : null;
  const to = Number.isFinite(band.to) ? shortMoney(band.to) : null;
  if (from === null) return `under ${to ?? ''}`;
  if (to === null) return `over ${from}`;
  return `${from}–${to}`;
}

/* -------------------------------------------------------------------------- */
/* The score on a piece of ground                                             */
/* -------------------------------------------------------------------------- */

/** The appetite score this account would have with that TIV tier and premium tier. */
export function cellScore(account: TerrainAccount, tivBand: Band, premiumBand: Band): number {
  return (
    account.basePoints + 100 * account.tivWeight * tivBand.tierValue + 100 * account.premiumWeight * premiumBand.tierValue
  );
}

/** The engine's verdict ladder (verdict.ts V-1..V-5) applied to one piece of ground. */
export function cellVerdict(account: TerrainAccount, tivBand: Band, premiumBand: Band): Verdict {
  if (account.knockedOutElsewhere || tivBand.tierValue === 0 || premiumBand.tierValue === 0) return 'DOES_NOT_FIT';
  if (account.refersElsewhere) return 'REFER';
  return 'FIT';
}

function cellColor(verdict: Verdict): string {
  return verdict === 'FIT' ? COLORS.red : verdict === 'REFER' ? COLORS.redTint : COLORS.ink;
}

/** A footprint carries its own verdict, so the floor shows where the fits and the refusals actually stand. */
function dotColor(f: TerrainFootprint): string {
  return f.verdict === 'FIT' ? COLORS.red : f.verdict === 'REFER' ? COLORS.redDeep : COLORS.mutedDeep;
}

/* -------------------------------------------------------------------------- */
/* Scene                                                                      */
/* -------------------------------------------------------------------------- */

interface Pickable {
  readonly mesh: THREE.Mesh;
  readonly cell?: TerrainCell;
  readonly footprint?: TerrainFootprint;
  readonly isPin?: boolean;
}

export function createTerrainScene(host: HTMLElement, callbacks: TerrainCallbacks): TerrainScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(COLORS.paper);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.45));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(80, 140, 60);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(-90, 40, -70);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 40;
  controls.maxDistance = 500;
  controls.maxPolarAngle = Math.PI / 2.05; // never under the ground

  let content = new THREE.Group();
  scene.add(content);
  let pickables: Pickable[] = [];
  let hovered: Pickable | null = null;

  const home = (): void => {
    camera.position.set(150, 140, 186);
    controls.target.set(24, Y_TOP * 0.38, 0);
    controls.update();
  };
  home();

  const resize = (): void => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const disposeGroup = (g: THREE.Object3D): void => {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of mats) {
        (x as THREE.SpriteMaterial).map?.dispose();
        x.dispose();
      }
    });
  };

  const addLabel = (text: string, at: THREE.Vector3, size: number, color: string): void => {
    const sprite = textSprite(text, { size, color });
    sprite.position.copy(at);
    content.add(sprite);
  };

  const setData = (
    account: TerrainAccount | null,
    footprints: readonly TerrainFootprint[],
    bands: AppetiteBands,
  ): void => {
    scene.remove(content);
    disposeGroup(content);
    content = new THREE.Group();
    scene.add(content);
    pickables = [];
    hovered = null;
    callbacks.onHover(null);
    if (account === null) return;

    /* Terraces: one slab per (TIV band × premium band), clipped to the axis range. */
    for (const tivBand of bands.tiv) {
      const x0 = xOf(Math.max(tivBand.from, TIV_MIN));
      const x1 = xOf(Math.min(tivBand.to, TIV_MAX));
      if (x1 - x0 < 0.5) continue;
      for (const premiumBand of bands.premium) {
        const z0 = zOf(Math.max(premiumBand.from, PREM_MIN));
        const z1 = zOf(Math.min(premiumBand.to, PREM_MAX));
        if (z1 - z0 < 0.5) continue;

        const score = cellScore(account, tivBand, premiumBand);
        const verdict = cellVerdict(account, tivBand, premiumBand);
        const height = Math.max(yOf(score), 0.6);
        const geometry = new THREE.BoxGeometry(x1 - x0 - 0.5, height, z1 - z0 - 0.5);
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: cellColor(verdict),
            roughness: 0.82,
            metalness: 0,
            transparent: true,
            // Knocked-out ground still has a score, but no premium can be written there:
            // it is drawn as ghost ground so the ground that fits stays readable.
            // Knocked-out ground still has a score, but no account can be written there.
            // It is drawn as an open cage at that height, so it never hides the ground that fits.
            opacity: verdict === 'DOES_NOT_FIT' ? 0.07 : 1,
          }),
        );
        mesh.position.set((x0 + x1) / 2, height / 2, (z0 + z1) / 2);
        content.add(mesh);
        // A wire edge keeps each step legible where two terraces share a height.
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({
            color: verdict === 'DOES_NOT_FIT' ? COLORS.muted : COLORS.redDeep,
            transparent: true,
            opacity: verdict === 'DOES_NOT_FIT' ? 0.5 : 0.5,
          }),
        );
        edges.position.copy(mesh.position);
        edges.raycast = () => undefined;
        content.add(edges);
        pickables.push({ mesh, cell: { tivBand, premiumBand, score, verdict } });

        // Score on top of each terrace, so the height is readable without guessing.
        addLabel(
          `${Math.round(score)}`,
          new THREE.Vector3((x0 + x1) / 2, height + 2.5, (z0 + z1) / 2),
          20,
          verdict === 'DOES_NOT_FIT' ? COLORS.muted : COLORS.ink,
        );
      }
    }

    /* Axis labels at the band edges, each naming the rule that cuts there. */
    for (const band of bands.tiv) {
      if (!Number.isFinite(band.from)) continue;
      const x = xOf(band.from);
      content.add(line([new THREE.Vector3(x, 0, -HALF), new THREE.Vector3(x, 0, HALF + 6)], COLORS.ink, 0.35));
      addLabel(`${shortMoney(band.from)} · ${band.ruleId}`, new THREE.Vector3(x, 0.5, HALF + 12), 20, COLORS.mutedDeep);
    }
    for (const band of bands.premium) {
      if (!Number.isFinite(band.from)) continue;
      const z = zOf(band.from);
      content.add(line([new THREE.Vector3(-HALF - 6, 0, z), new THREE.Vector3(HALF, 0, z)], COLORS.ink, 0.35));
      addLabel(`${shortMoney(band.from)} · ${band.ruleId}`, new THREE.Vector3(-HALF - 20, 0.5, z), 20, COLORS.mutedDeep);
    }
    addLabel('Total insured value →', new THREE.Vector3(0, 0.5, HALF + 22), 30, COLORS.ink);
    addLabel('Quoted premium →', new THREE.Vector3(-HALF - 30, 0.5, 0), 30, COLORS.ink);

    /* Every account that has a TIV and a premium stands on the floor. */
    const offMap: TerrainFootprint[] = [];
    for (const f of footprints) {
      if (f.tiv === null || f.premium === null) {
        offMap.push(f);
        continue;
      }
      const selected = f.submissionId === account.submissionId;
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(selected ? 1.6 : 1.1, 20),
        new THREE.MeshBasicMaterial({
          color: selected ? COLORS.red : dotColor(f),
          transparent: true,
          opacity: selected ? 1 : 0.65,
        }),
      );
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(xOf(f.tiv), 0.15, zOf(f.premium));
      content.add(dot);
      pickables.push({ mesh: dot, footprint: f });
    }

    /*
     * Accounts with no TIV or no quoted premium have no place on this floor, so
     * they wait in a tray beside it rather than being dropped. Most are the rows
     * scored on another line of business, which these bands never applied to.
     */
    const trayPositions = new Map<string, THREE.Vector3>();
    if (offMap.length > 0) {
      // A grid to the right of the terrain, clear of every axis label.
      const perRow = 10;
      const gap = 3.6;
      const originX = HALF + 26;
      const originZ = -HALF + 6;
      offMap.forEach((f, i) => {
        const at = new THREE.Vector3(originX + (i % perRow) * gap, 0.15, originZ + Math.floor(i / perRow) * gap);
        trayPositions.set(f.submissionId, at);
        const selected = f.submissionId === account.submissionId;
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(selected ? 1.5 : 1, 16),
          new THREE.MeshBasicMaterial({
            color: selected ? COLORS.red : dotColor(f),
            transparent: true,
            opacity: selected ? 1 : 0.5,
          }),
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.copy(at);
        content.add(dot);
        pickables.push({ mesh: dot, footprint: f });
      });
      const otherLines = offMap.filter((f) => f.otherLine === true).length;
      const detail = otherLines === 0 ? '' : ` · ${otherLines} on another line of business`;
      addLabel(
        `Off the floor: no TIV or quoted premium (${offMap.length})${detail}`,
        new THREE.Vector3(originX + 16, 0.5, originZ - 9),
        26,
        COLORS.mutedDeep,
      );
    }

    /* The selected account's pin, standing on its own terrace. */
    if (account.tiv !== null && account.premium !== null) {
      const tivBand = bandAt(bands.tiv, account.tiv);
      const premiumBand = bandAt(bands.premium, account.premium);
      const x = xOf(account.tiv);
      const z = zOf(account.premium);
      const top =
        tivBand !== null && premiumBand !== null ? yOf(cellScore(account, tivBand, premiumBand)) : yOf(account.appetiteScore);
      const stalkTop = top + 16;
      content.add(line([new THREE.Vector3(x, top, z), new THREE.Vector3(x, stalkTop, z)], COLORS.ink, 0.8));
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(2.8, 24, 16),
        new THREE.MeshStandardMaterial({
          color: account.verdict === 'REFER' ? COLORS.redTint : VERDICT_STYLES[account.verdict].fill,
          roughness: 0.5,
        }),
      );
      cap.position.set(x, stalkTop, z);
      content.add(cap);
      pickables.push({ mesh: cap, isPin: true, footprint: account });
      addLabel(
        `${account.insuredName} · ${Math.round(account.appetiteScore)}`,
        new THREE.Vector3(x, stalkTop + 6, z),
        26,
        COLORS.ink,
      );

      /* The nearest ground that fits: what would have to change. */
      const targetTiv = bands.tiv.find((b) => b.tier === 'target');
      const targetPrem = bands.premium.find((b) => b.tier === 'target');
      const alreadyThere = tivBand?.tier === 'target' && premiumBand?.tier === 'target';
      if (!account.knockedOutElsewhere && targetTiv !== undefined && targetPrem !== undefined && !alreadyThere) {
        const tx = xOf(clamp(account.tiv, targetTiv.from, targetTiv.to));
        const tz = zOf(clamp(account.premium, targetPrem.from, targetPrem.to));
        const ty = yOf(cellScore(account, targetTiv, targetPrem));
        const from = new THREE.Vector3(x, stalkTop, z);
        const to = new THREE.Vector3(tx, ty + 10, tz);
        const arrow = new THREE.ArrowHelper(
          to.clone().sub(from).normalize(),
          from,
          from.distanceTo(to),
          COLORS.redDeep,
          4,
          2.6,
        );
        arrow.traverse((o) => {
          o.raycast = () => undefined;
        });
        content.add(arrow);
        const changes: string[] = [];
        if (tivBand?.tier !== 'target') changes.push(`TIV ${bandLabel(targetTiv)}`);
        if (premiumBand?.tier !== 'target') changes.push(`premium ${bandLabel(targetPrem)}`);
        addLabel(changes.join(', '), to.clone().add(new THREE.Vector3(0, -6, 0)), 22, COLORS.redDeep);
      }
    } else {
      /* Selected but off the floor: the pin stands in the tray, over nothing. */
      const at = trayPositions.get(account.submissionId) ?? new THREE.Vector3(HALF + 26, 0.15, -HALF + 6);
      const stalkTop = 14;
      content.add(line([at, new THREE.Vector3(at.x, stalkTop, at.z)], COLORS.ink, 0.8));
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(2.4, 24, 16),
        new THREE.MeshStandardMaterial({
          color: account.verdict === 'REFER' ? COLORS.redTint : VERDICT_STYLES[account.verdict].fill,
          roughness: 0.5,
        }),
      );
      cap.position.set(at.x, stalkTop, at.z);
      content.add(cap);
      pickables.push({ mesh: cap, isPin: true, footprint: account });
      addLabel(
        `${account.insuredName} · no TIV or premium to stand on`,
        new THREE.Vector3(at.x + 16, stalkTop + 6, at.z),
        24,
        COLORS.ink,
      );
    }
  };

  /* Pointer handling: hover, click a footprint to re-form, click the pin to open. */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;

  const pick = (ev: PointerEvent): Pickable | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      pickables.map((p) => p.mesh),
      false,
    );
    const hit = hits[0];
    return hit === undefined ? null : (pickables.find((p) => p.mesh === hit.object) ?? null);
  };

  const onMove = (ev: PointerEvent): void => {
    const node = pick(ev);
    if (hovered !== null && hovered !== node && hovered.isPin !== true) hovered.mesh.scale.setScalar(1);
    hovered = node;
    renderer.domElement.style.cursor = node === null ? 'grab' : 'pointer';
    if (node === null) {
      callbacks.onHover(null);
      return;
    }
    if (node.isPin !== true) node.mesh.scale.setScalar(node.footprint === undefined ? 1 : 1.4);
    const rect = host.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    if (node.cell !== undefined) callbacks.onHover({ kind: 'cell', cell: node.cell, x, y });
    else if (node.footprint !== undefined)
      callbacks.onHover({ kind: node.isPin === true ? 'pin' : 'footprint', footprint: node.footprint, x, y });
  };
  const onDown = (ev: PointerEvent): void => {
    downAt = { x: ev.clientX, y: ev.clientY };
  };
  const onUp = (ev: PointerEvent): void => {
    if (downAt === null) return;
    const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
    downAt = null;
    if (moved > 5) return;
    const node = pick(ev);
    if (node === null || node.footprint === undefined) return;
    if (node.isPin === true) callbacks.onOpen(node.footprint.submissionId);
    else callbacks.onSelect(node.footprint.submissionId);
  };
  const onLeave = (): void => {
    if (hovered !== null && hovered.isPin !== true) hovered.mesh.scale.setScalar(1);
    hovered = null;
    callbacks.onHover(null);
  };

  const el = renderer.domElement;
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointerleave', onLeave);

  let frame = 0;
  const loop = (): void => {
    frame = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    setData,
    resetView: home,
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      disposeGroup(scene);
      renderer.dispose();
      el.remove();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Building the account from the API's own numbers                            */
/* -------------------------------------------------------------------------- */

/** The two factors the terrain sweeps; every other factor is held where the account has it. */
const SWEPT_FACTORS = new Set(['tiv', 'total_premium']);

/**
 * Turn a submission detail into terrain input. Every number is the API's:
 * `basePoints` is the sum of the account's own factor points outside the two
 * swept factors, and the swept weights are the account's own weights, so the
 * pin's terrace height equals the appetite score the queue shows.
 */
export function terrainAccountOf(detail: TerrainDetail): TerrainAccount {
  const others = detail.factors.filter((f) => !SWEPT_FACTORS.has(f.factorId));
  const weightOf = (factorId: string, fallback: number): number =>
    detail.factors.find((f) => f.factorId === factorId)?.weight ?? fallback;
  return {
    submissionId: detail.submissionId,
    insuredName: detail.insuredName,
    verdict: detail.verdict,
    tiv: detail.rollup.totalTiv,
    premium: detail.pricing.quotedPremium,
    appetiteScore: detail.appetiteScore,
    basePoints: others.reduce((sum, f) => sum + f.points, 0),
    tivWeight: weightOf('tiv', 0.15),
    premiumWeight: weightOf('total_premium', 0.15),
    knockedOutElsewhere: others.some((f) => f.knockout),
    refersElsewhere:
      others.some((f) => !f.known || f.tier === 'refer') ||
      detail.contradictions.some((c) => c.severity === 'HIGH' && c.status === 'open'),
  };
}

/** The slice of `SubmissionDetailView` the terrain reads. */
export interface TerrainDetail {
  readonly submissionId: string;
  readonly insuredName: string;
  readonly verdict: Verdict;
  readonly appetiteScore: number;
  readonly factors: readonly {
    readonly factorId: string;
    readonly weight: number;
    readonly points: number;
    readonly known: boolean;
    readonly knockout: boolean;
    readonly tier: string | null;
  }[];
  readonly rollup: { readonly totalTiv: number | null };
  readonly pricing: { readonly quotedPremium: number | null };
  readonly contradictions: readonly { readonly severity: string; readonly status: string }[];
}
