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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COLORS, FONT_STACKS, VERDICT_STYLES } from '@retrofit/design';
/* -------------------------------------------------------------------------- */
/* Scales                                                                     */
/* -------------------------------------------------------------------------- */
const HALF = 50;
const ADEQ_MIN = 0.4;
const ADEQ_MAX = 1.6;
const TIV_MIN = 1e6;
const TIV_MAX = 2e8;
const Y_TOP = 60;
const FLOOR_Y = -10;
const BACK_Z = -HALF - 10;
const PREMIUM_REF = 175_000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const xOf = (appetite) => (clamp(appetite, 0, 100) / 100) * 2 * HALF - HALF;
const yOf = (adequacy) => ((clamp(adequacy, ADEQ_MIN, ADEQ_MAX) - ADEQ_MIN) / (ADEQ_MAX - ADEQ_MIN)) * Y_TOP;
const zOf = (tiv) => {
    const t = (Math.log10(clamp(tiv, TIV_MIN, TIV_MAX)) - Math.log10(TIV_MIN)) / (Math.log10(TIV_MAX) - Math.log10(TIV_MIN));
    return t * 2 * HALF - HALF;
};
const radiusOf = (premium) => premium === null ? 1.1 : 1.1 + 2.2 * Math.sqrt(clamp(premium, 0, PREMIUM_REF * 4) / PREMIUM_REF);
/** Deterministic 0..1 jitter from a string, so rows stacked on one point spread the same way every render. */
function hash01(s, salt) {
    let h = 2166136261 ^ salt;
    for (let i = 0; i < s.length; i++)
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return ((h >>> 0) % 10_000) / 10_000;
}
export function scatterPosition(row) {
    const jx = (hash01(row.submissionId, 1) - 0.5) * 2.4;
    const jz = (hash01(row.submissionId, 2) - 0.5) * 2.4;
    const x = xOf(row.appetiteScore) + jx;
    const y = row.adequacy === null ? FLOOR_Y : yOf(row.adequacy);
    const z = row.totalTiv === null ? BACK_Z + jz : zOf(row.totalTiv) + jz;
    return new THREE.Vector3(x, y, z);
}
/* -------------------------------------------------------------------------- */
/* Materials and labels                                                       */
/* -------------------------------------------------------------------------- */
/**
 * Straight from VERDICT_STYLES, so a point in the book is the colour of the
 * pill beside it and of the pill on the phone. REFER used to need a stand-in
 * fill because it was an outlined pill; it is amber-filled now, so it does not.
 */
function verdictMaterial(verdict) {
    const color = VERDICT_STYLES[verdict].fill;
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 1 });
}
export function textSprite(text, opts = {}) {
    const size = opts.size ?? 28;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${opts.weight ?? 500} ${size * 2}px ${FONT_STACKS.body}`;
    if (ctx === null)
        return new THREE.Sprite();
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 16;
    const h = size * 2 + 16;
    canvas.width = w;
    canvas.height = h;
    ctx.font = font;
    ctx.fillStyle = opts.color ?? COLORS.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 8, h / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    const scale = size / 5;
    sprite.scale.set((w / h) * scale, scale, 1);
    return sprite;
}
export function line(points, color, opacity = 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints([...points]);
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}
/* -------------------------------------------------------------------------- */
/* Scatter furniture                                                          */
/* -------------------------------------------------------------------------- */
function scatterAxes(group) {
    const ink = COLORS.ink;
    const faint = COLORS.muted;
    const o = new THREE.Vector3(-HALF, 0, -HALF);
    group.add(line([o, new THREE.Vector3(HALF, 0, -HALF)], ink));
    group.add(line([o, new THREE.Vector3(-HALF, Y_TOP, -HALF)], ink));
    group.add(line([o, new THREE.Vector3(-HALF, 0, HALF)], ink));
    // Base grid on the floor of the chart.
    for (let i = 0; i <= 10; i++) {
        const t = -HALF + (i / 10) * 2 * HALF;
        group.add(line([new THREE.Vector3(t, 0, -HALF), new THREE.Vector3(t, 0, HALF)], faint, 0.18));
        group.add(line([new THREE.Vector3(-HALF, 0, t), new THREE.Vector3(HALF, 0, t)], faint, 0.18));
    }
    // Adequacy = 100% reference plane edge.
    const y100 = yOf(1);
    group.add(line([
        new THREE.Vector3(-HALF, y100, -HALF),
        new THREE.Vector3(HALF, y100, -HALF),
        new THREE.Vector3(HALF, y100, HALF),
        new THREE.Vector3(-HALF, y100, HALF),
        new THREE.Vector3(-HALF, y100, -HALF),
    ], COLORS.red, 0.35));
    const tick = (text, pos, size = 22, color = COLORS.mutedDeep) => {
        const s = textSprite(text, { size, color });
        s.position.copy(pos);
        group.add(s);
    };
    for (const a of [0, 25, 50, 75, 100])
        tick(String(a), new THREE.Vector3(xOf(a), -3, HALF + 4));
    tick('Appetite score →', new THREE.Vector3(0, -8, HALF + 10), 28, COLORS.ink);
    for (const q of [0.5, 0.75, 1, 1.25, 1.5])
        tick(`${Math.round(q * 100)}%`, new THREE.Vector3(-HALF - 6, yOf(q), -HALF));
    tick('Pricing adequacy ↑', new THREE.Vector3(-HALF - 8, Y_TOP + 7, -HALF), 28, COLORS.ink);
    for (const t of [1e6, 1e7, 5e7, 1e8]) {
        tick(t >= 1e8 ? '$100M' : t >= 1e7 ? `$${t / 1e6}M` : '$1M', new THREE.Vector3(HALF + 8, -3, zOf(t)));
    }
    tick('Total insured value (log) →', new THREE.Vector3(HALF + 16, -9, 0), 28, COLORS.ink);
    // The "no price" floor and "no TIV" wall, so unpriced rows are shown, not dropped.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF), new THREE.MeshBasicMaterial({ color: COLORS.mutedTint, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y - 1.5;
    group.add(floor);
    tick('No price yet (adequacy n/a)', new THREE.Vector3(-HALF + 14, FLOOR_Y - 1, HALF + 4), 20);
}
/**
 * Four neutrals and the accent. Amber and red stay out of it: they mean REFER
 * and DOES_NOT_FIT on the points, and a hub is not a verdict. Every hub also
 * carries a text label, so these only tell the four kinds apart at a glance.
 */
const HUB_COLOR = {
    underwriter: COLORS.ink,
    state: COLORS.mute,
    line: COLORS.accent,
    verdict: COLORS.muteTint,
};
function hubsOf(rows) {
    const map = new Map();
    const add = (kind, label, rowId) => {
        if (label === null || label.trim() === '')
            return;
        const id = `${kind}:${label}`;
        const hub = map.get(id) ?? { id, kind, label, members: [] };
        hub.members.push(rowId);
        map.set(id, hub);
    };
    for (const r of rows) {
        add('underwriter', r.assignedUnderwriter, r.submissionId);
        add('state', r.primaryState, r.submissionId);
        add('line', r.lineOfBusiness, r.submissionId);
        add('verdict', VERDICT_STYLES[r.verdict].short, r.submissionId);
    }
    return [...map.values()];
}
/** Deterministic force layout: repulsion between all nodes, springs on edges, gentle centering. */
function forceLayout(ids, edges, hubCount) {
    const n = ids.length;
    const pos = ids.map((id, i) => {
        const r = i < hubCount ? 30 : 55;
        const u = hash01(id, 3) * 2 - 1;
        const t = hash01(id, 4) * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        return new THREE.Vector3(r * s * Math.cos(t), r * u, r * s * Math.sin(t));
    });
    const vel = ids.map(() => new THREE.Vector3());
    const d = new THREE.Vector3();
    const REPULSE = 900;
    const SPRING = 0.02;
    const REST = 16;
    for (let tick = 0; tick < 300; tick++) {
        const cool = 1 - tick / 300;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                d.subVectors(pos[i], pos[j]);
                const dist2 = Math.max(d.lengthSq(), 4);
                d.multiplyScalar(REPULSE / (dist2 * Math.sqrt(dist2)));
                vel[i].add(d);
                vel[j].sub(d);
            }
        }
        for (const [a, b] of edges) {
            d.subVectors(pos[b], pos[a]);
            const len = Math.max(d.length(), 0.001);
            d.multiplyScalar((SPRING * (len - REST)) / len);
            vel[a].add(d);
            vel[b].sub(d);
        }
        for (let i = 0; i < n; i++) {
            vel[i].addScaledVector(pos[i], -0.004);
            vel[i].multiplyScalar(0.6);
            pos[i].addScaledVector(vel[i], cool);
        }
    }
    return pos;
}
export function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        return c.getContext('webgl2') !== null || c.getContext('webgl') !== null;
    }
    catch {
        return false;
    }
}
export function createExploreScene(host, callbacks) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(COLORS.paper);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(60, 120, 80);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 30;
    controls.maxDistance = 600;
    let content = new THREE.Group();
    scene.add(content);
    let nodes = [];
    let edgesLine = null;
    let edgeIndex = [];
    let mode = 'scatter';
    let selectedHub = null;
    let hovered = null;
    let netRadius = 60;
    const home = () => {
        if (mode === 'scatter') {
            camera.position.set(100, 72, 112);
            controls.target.set(0, Y_TOP / 3, 0);
        }
        else {
            camera.position.set(0, netRadius * 0.2, netRadius * 1.35);
            controls.target.set(0, 0, 0);
        }
        controls.update();
    };
    const resize = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (w === 0 || h === 0)
            return;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = `${w}px`;
        renderer.domElement.style.height = `${h}px`;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const disposeGroup = (g) => {
        g.traverse((o) => {
            const m = o;
            m.geometry?.dispose();
            const mat = m.material;
            const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
            for (const x of mats) {
                const map = x.map;
                map?.dispose();
                x.dispose();
            }
        });
    };
    const applyHighlight = () => {
        const members = selectedHub === null ? null : new Set(nodes.find((n) => n.hub?.id === selectedHub)?.hub?.members ?? []);
        for (const n of nodes) {
            const mat = n.mesh.material;
            const lit = members === null ||
                (n.row !== undefined && members.has(n.row.submissionId)) ||
                (n.hub !== undefined && n.hub.id === selectedHub);
            mat.opacity = lit ? 1 : 0.12;
            mat.depthWrite = lit;
        }
        if (edgesLine !== null) {
            const colors = edgesLine.geometry.getAttribute('color');
            const on = new THREE.Color(COLORS.red);
            const off = new THREE.Color(COLORS.muted);
            edgeIndex.forEach((e, i) => {
                const c = selectedHub !== null && e.hub === selectedHub ? on : off;
                colors.setXYZ(i * 2, c.r, c.g, c.b);
                colors.setXYZ(i * 2 + 1, c.r, c.g, c.b);
            });
            colors.needsUpdate = true;
            edgesLine.material.opacity = selectedHub === null ? 0.25 : 0.5;
        }
    };
    const rowMesh = (row) => {
        const r = radiusOf(row.quotedPremium);
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), verdictMaterial(row.verdict));
        if (row.verdict === 'REFER') {
            // REFER is an outlined pill in the console: a red wire shell here.
            const shell = new THREE.Mesh(new THREE.SphereGeometry(r * 1.04, 12, 8), new THREE.MeshBasicMaterial({ color: COLORS.red, wireframe: true, transparent: true, opacity: 0.7 }));
            shell.raycast = () => undefined;
            mesh.add(shell);
        }
        if (row.synthetic) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.6, 0.18, 8, 40), new THREE.MeshBasicMaterial({ color: COLORS.mutedDeep }));
            ring.rotation.x = Math.PI / 2;
            ring.raycast = () => undefined;
            mesh.add(ring);
        }
        return mesh;
    };
    const setData = (rows, nextMode) => {
        const modeChanged = nextMode !== mode || nodes.length === 0;
        mode = nextMode;
        selectedHub = null;
        hovered = null;
        callbacks.onHover(null);
        scene.remove(content);
        disposeGroup(content);
        content = new THREE.Group();
        scene.add(content);
        nodes = [];
        edgesLine = null;
        edgeIndex = [];
        if (mode === 'scatter') {
            scatterAxes(content);
            for (const row of rows) {
                const mesh = rowMesh(row);
                mesh.position.copy(scatterPosition(row));
                content.add(mesh);
                nodes.push({ mesh, row });
                if (row.adequacy !== null) {
                    // A drop line to the floor makes depth readable while orbiting.
                    const p = mesh.position;
                    content.add(line([p.clone(), new THREE.Vector3(p.x, 0, p.z)], COLORS.muted, 0.25));
                }
            }
        }
        else {
            const hubs = hubsOf(rows);
            const ids = [...hubs.map((h) => h.id), ...rows.map((r) => r.submissionId)];
            const indexOf = new Map(ids.map((id, i) => [id, i]));
            const edges = [];
            for (const h of hubs) {
                for (const m of h.members) {
                    edges.push([indexOf.get(h.id), indexOf.get(m)]);
                    edgeIndex.push({ hub: h.id, row: m });
                }
            }
            const pos = forceLayout(ids, edges, hubs.length);
            netRadius = Math.max(40, ...pos.map((p) => p.length()));
            hubs.forEach((hub, i) => {
                const size = 2 + Math.sqrt(hub.members.length) * 0.9;
                const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), new THREE.MeshStandardMaterial({ color: HUB_COLOR[hub.kind], roughness: 0.7, transparent: true, opacity: 1, flatShading: true }));
                mesh.position.copy(pos[i]);
                const label = textSprite(hub.kind === 'line' ? hub.label.replace(/_/g, ' ') : hub.label, { size: 30, color: COLORS.ink, weight: 600 });
                label.position.set(0, size + 3, 0);
                label.raycast = () => undefined;
                mesh.add(label);
                content.add(mesh);
                nodes.push({ mesh, hub });
            });
            rows.forEach((row, j) => {
                const mesh = rowMesh(row);
                mesh.position.copy(pos[hubs.length + j]);
                content.add(mesh);
                nodes.push({ mesh, row });
            });
            const positions = new Float32Array(edges.length * 6);
            edges.forEach(([a, b], i) => {
                pos[a].toArray(positions, i * 6);
                pos[b].toArray(positions, i * 6 + 3);
            });
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(edges.length * 6), 3));
            edgesLine = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.25, depthWrite: false }));
            edgesLine.raycast = () => undefined;
            content.add(edgesLine);
        }
        applyHighlight();
        if (modeChanged)
            home();
    };
    /* Pointer: hover, click-to-open, click-a-hub-to-highlight. */
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;
    const pick = (ev) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(nodes.map((n) => n.mesh), false);
        for (const h of hits) {
            const node = nodes.find((n) => n.mesh === h.object);
            if (node === undefined)
                continue;
            if (node.mesh.material.opacity < 0.5)
                continue;
            return node;
        }
        return null;
    };
    const onMove = (ev) => {
        const node = pick(ev);
        const rect = host.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        if (hovered !== null && hovered !== node)
            hovered.mesh.scale.setScalar(1);
        hovered = node;
        renderer.domElement.style.cursor = node === null ? 'grab' : 'pointer';
        if (node === null) {
            callbacks.onHover(null);
            return;
        }
        node.mesh.scale.setScalar(1.25);
        if (node.row !== undefined)
            callbacks.onHover({ kind: 'row', row: node.row, x, y });
        else if (node.hub !== undefined)
            callbacks.onHover({ kind: 'hub', hubKind: node.hub.kind, label: node.hub.label, count: node.hub.members.length, x, y });
    };
    const onDown = (ev) => {
        downAt = { x: ev.clientX, y: ev.clientY };
    };
    const onUp = (ev) => {
        if (downAt === null)
            return;
        const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
        downAt = null;
        if (moved > 5)
            return; // an orbit drag, not a click
        const node = pick(ev);
        if (node?.row !== undefined) {
            callbacks.onOpen(node.row);
        }
        else if (node?.hub !== undefined) {
            selectedHub = selectedHub === node.hub.id ? null : node.hub.id;
            applyHighlight();
        }
        else if (selectedHub !== null) {
            selectedHub = null;
            applyHighlight();
        }
    };
    const onLeave = () => {
        if (hovered !== null)
            hovered.mesh.scale.setScalar(1);
        hovered = null;
        callbacks.onHover(null);
    };
    const el = renderer.domElement;
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    let frame = 0;
    const loop = () => {
        frame = requestAnimationFrame(loop);
        controls.update();
        renderer.render(scene, camera);
    };
    loop();
    return {
        setData,
        resetView: () => {
            selectedHub = null;
            applyHighlight();
            home();
        },
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
//# sourceMappingURL=explore-scene.js.map