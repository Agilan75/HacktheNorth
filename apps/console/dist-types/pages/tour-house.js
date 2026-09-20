/**
 * The tour house: one procedural apartment, and a camera on a rail through it.
 *
 * Nothing here is data. It is the marketing surface for `/tour` — the same
 * metaphor the phone app runs for real (sweep the room, label what the camera
 * passes, price it), drawn once in three.js so the website can walk a visitor
 * through the argument instead of writing it down.
 *
 * The page owns scroll; this module owns pixels. `setProgress(t)` takes a
 * 0..1 position along the camera spline and the module eases toward it,
 * re-renders while it is moving, and writes each anchor's screen position onto
 * the badge element the page registered for it. React never sees a frame.
 */
import * as THREE from 'three';
import { COLORS } from '@retrofit/design';
import { buildPipeline } from './tour-pipeline.js';
/* -------------------------------------------------------------------------- */
/* Anchors                                                                    */
/* -------------------------------------------------------------------------- */
/** Every point in the room a badge can hang off. */
export const ANCHOR_IDS = ['heater', 'curtain', 'bed', 'detector', 'desk', 'fix'];
/** Progress window in which an anchor's badge is on screen, with a fade at each edge. */
const WINDOWS = {
    heater: [0.06, 0.44],
    curtain: [0.26, 0.46],
    bed: [0.26, 0.46],
    detector: [0.42, 0.6],
    desk: [0.6, 0.78],
    fix: [0.8, 1.0],
};
/** Where the heater sits before and after the fix; the last section slides it. */
const HEATER_PLACED = new THREE.Vector3(-2.55, 0.36, -2.6);
const HEATER_MOVED = new THREE.Vector3(-3.9, 0.36, 1.9);
/** Progress at which the heater starts and finishes moving to the far wall. */
const FIX_FROM = 0.7;
const FIX_TO = 0.84;
export function webglAvailable() {
    try {
        // Checked before touching a canvas: jsdom has no WebGL at all, and calling
        // `getContext` there logs a "not implemented" error even inside a try.
        if (!('WebGL2RenderingContext' in window) && !('WebGLRenderingContext' in window))
            return false;
        const c = document.createElement('canvas');
        return c.getContext('webgl2') !== null || c.getContext('webgl') !== null;
    }
    catch {
        return false;
    }
}
/* -------------------------------------------------------------------------- */
/* Palette                                                                    */
/* -------------------------------------------------------------------------- */
/** --rf-blue-tint, inlined; see the note at the desk screen. */
const SCREEN_BLUE = '#E4EAF1';
const MAT = {
    floor: '#E8E1D2',
    rug: '#D6DBCE',
    wall: '#F6F1E7',
    ceiling: '#F1ECE0',
    trim: '#DCD5C6',
    wood: '#C2AE92',
    woodDeep: '#A28E73',
    fabric: '#E2E5DB',
    fabricDeep: '#CBD0C2',
    curtain: '#EFE8D9',
    metal: '#B9BDB1',
    glow: '#FBF6E8',
};
function flat(color, roughness = 0.92) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}
function box(w, h, d, material, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    return mesh;
}
/* -------------------------------------------------------------------------- */
/* The camera rail                                                            */
/* -------------------------------------------------------------------------- */
/**
 * Eye positions and look-at targets, one pair per beat of `TourPage`. Beat *i*
 * of *n* sits at `i / (n - 1)` on the rail, so these must stay the same length
 * as `BEATS` and in the same order: entry, heater, hazard, ceiling, desk, fix,
 * wide, lift, doors, core, surfaces.
 *
 * The first seven are inside the apartment. The last four leave it: the camera
 * rises until the room reads as a box, pulls back until it is one of two source
 * nodes, flies down the streams into `apps/api`, and finally backs off with the
 * two output surfaces lit. Sampling is `getPoint(t)`, which is parameter-based,
 * so appending these did not move any of the room beats off their marks.
 */
const EYES = [
    new THREE.Vector3(2.6, 1.66, 2.9),
    new THREE.Vector3(-1.5, 1.0, -1.5),
    new THREE.Vector3(-1.0, 1.3, -0.2),
    new THREE.Vector3(-1.0, 1.15, 1.2),
    new THREE.Vector3(1.4, 1.45, -0.6),
    new THREE.Vector3(-1.0, 1.4, 2.2),
    new THREE.Vector3(1.6, 2.0, 3.4),
    new THREE.Vector3(7.0, 11.0, 15.0),
    new THREE.Vector3(8.0, 13.0, 27.0),
    new THREE.Vector3(34.0, 5.0, 10.0),
    new THREE.Vector3(64.0, 10.0, 24.0),
];
const LOOKS = [
    new THREE.Vector3(-0.8, 1.3, -1.8),
    new THREE.Vector3(-2.6, 0.4, -2.5),
    new THREE.Vector3(-2.9, 1.3, -2.9),
    new THREE.Vector3(-0.3, 2.45, -1.0),
    new THREE.Vector3(3.4, 1.05, -2.3),
    new THREE.Vector3(-3.6, 0.5, 1.8),
    new THREE.Vector3(-1.2, 1.2, -2.2),
    new THREE.Vector3(0.0, 1.2, 0.0),
    new THREE.Vector3(17.0, 2.0, -10.0),
    new THREE.Vector3(34.0, 3.0, -10.0),
    new THREE.Vector3(57.0, 3.0, -11.0),
];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/**
 * The rail is one continuous camera move, but only its first part is the room.
 * Beats 0-6 walk the apartment; beats 7-10 pull out of it and travel the
 * pipeline. `ROOM_SPAN` is where the room ends — `6 / (BEATS.length - 1)`.
 *
 * Everything the room times off (badge windows, the heater's fix) is expressed
 * in ROOM-LOCAL progress, so none of those numbers had to change when the rail
 * grew. Add or remove a room beat and this is the only constant to update.
 */
const ROOM_SPAN = 0.6;
/** Fog while inside the room: tight, so the far wall reads as an interior. */
const FOG_ROOM = [12, 26];
/** Fog once out on the pipeline, which is ~90 units long end to end. */
const FOG_PIPE = [70, 300];
/** Pipeline-local progress over which the fog opens up. */
const FOG_OPEN = [0.0, 0.35];
/** 0 outside the window, 1 inside it, eased across a `fade`-wide lip at each edge. */
function windowOpacity(t, [from, to], fade = 0.06) {
    if (t <= from - fade || t >= to + fade)
        return 0;
    const rising = clamp01((t - (from - fade)) / fade);
    const falling = clamp01((to + fade - t) / fade);
    const raw = Math.min(rising, falling);
    return raw * raw * (3 - 2 * raw);
}
/* -------------------------------------------------------------------------- */
/* The room                                                                   */
/* -------------------------------------------------------------------------- */
const W = 10;
const D = 7;
const H = 2.72;
function buildRoom() {
    const root = new THREE.Group();
    const materials = [];
    const geometries = [];
    const keep = (m) => {
        materials.push(m);
        return m;
    };
    const track = (o) => {
        o.traverse((child) => {
            if (child instanceof THREE.Mesh)
                geometries.push(child.geometry);
        });
    };
    const floorMat = keep(flat(MAT.floor));
    const wallMat = keep(flat(MAT.wall));
    // Unlit: a ceiling only ever faces away from the sky light and the sun, so a
    // shaded one renders as a dark lid over the whole frame.
    const ceilMat = keep(new THREE.MeshBasicMaterial({ color: MAT.ceiling }));
    const trimMat = keep(flat(MAT.trim));
    const woodMat = keep(flat(MAT.wood, 0.8));
    const woodDeepMat = keep(flat(MAT.woodDeep, 0.8));
    const fabricMat = keep(flat(MAT.fabric));
    const fabricDeepMat = keep(flat(MAT.fabricDeep));
    const curtainMat = keep(flat(MAT.curtain, 0.98));
    const metalMat = keep(new THREE.MeshStandardMaterial({ color: MAT.metal, roughness: 0.5, metalness: 0.4 }));
    const redMat = keep(flat(COLORS.red, 0.6));
    const rugMat = keep(flat(MAT.rug));
    // Shell. The front wall (z = +D/2) is left open so the camera can start
    // outside the room and drive in without clipping through anything.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = H;
    root.add(ceiling);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
    back.position.set(0, H / 2, -D / 2);
    root.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat);
    left.rotation.y = Math.PI / 2;
    left.position.set(-W / 2, H / 2, 0);
    root.add(left);
    const right = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat);
    right.rotation.y = -Math.PI / 2;
    right.position.set(W / 2, H / 2, 0);
    root.add(right);
    // Baseboards, so the wall/floor seam reads at eye height.
    root.add(box(W, 0.11, 0.05, trimMat, 0, 0.055, -D / 2 + 0.025));
    root.add(box(0.05, 0.11, D, trimMat, -W / 2 + 0.025, 0.055, 0));
    root.add(box(0.05, 0.11, D, trimMat, W / 2 - 0.025, 0.055, 0));
    // Window on the back wall, with a bright pane and two curtain panels.
    const paneMat = keep(new THREE.MeshStandardMaterial({ color: MAT.glow, emissive: new THREE.Color(MAT.glow), emissiveIntensity: 0.45, roughness: 1 }));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.5), paneMat);
    pane.position.set(-1.5, 1.55, -D / 2 + 0.02);
    root.add(pane);
    root.add(box(2.8, 0.08, 0.07, trimMat, -1.5, 2.34, -D / 2 + 0.05));
    root.add(box(2.8, 0.08, 0.07, trimMat, -1.5, 0.76, -D / 2 + 0.05));
    root.add(box(0.08, 1.66, 0.07, trimMat, -2.86, 1.55, -D / 2 + 0.05));
    root.add(box(0.08, 1.66, 0.07, trimMat, -0.14, 1.55, -D / 2 + 0.05));
    root.add(box(3.1, 0.05, 0.07, metalMat, -1.5, 2.48, -D / 2 + 0.09));
    const curtainL = box(0.62, 2.1, 0.09, curtainMat, -2.86, 1.42, -D / 2 + 0.14);
    const curtainR = box(0.62, 2.1, 0.09, curtainMat, -0.16, 1.42, -D / 2 + 0.14);
    root.add(curtainL, curtainR);
    // The heater: the whole page hangs off this one object.
    const heater = new THREE.Group();
    heater.add(box(0.56, 0.66, 0.26, redMat, 0, 0, 0));
    heater.add(box(0.6, 0.06, 0.3, metalMat, 0, 0.36, 0));
    const grille = keep(flat('#8E1220', 0.7));
    heater.add(box(0.42, 0.4, 0.02, grille, 0, 0.02, 0.14));
    heater.position.copy(HEATER_PLACED);
    root.add(heater);
    // Bed, back-left. Fabric within reach of the heater is the whole hazard.
    const bed = new THREE.Group();
    bed.add(box(2.0, 0.32, 2.3, woodMat, 0, 0.16, 0));
    bed.add(box(1.94, 0.24, 2.24, fabricMat, 0, 0.44, 0));
    bed.add(box(1.7, 0.16, 0.5, fabricDeepMat, 0, 0.6, -0.8));
    bed.add(box(2.06, 0.9, 0.1, woodDeepMat, 0, 0.45, -1.2));
    bed.position.set(-3.6, 0, -1.2);
    root.add(bed);
    // Rug, sofa, desk: the rest of the room, so the camera has something to pass.
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.6, 0.006, 0.9);
    root.add(rug);
    const sofa = new THREE.Group();
    sofa.add(box(2.2, 0.42, 0.95, fabricDeepMat, 0, 0.21, 0));
    sofa.add(box(2.2, 0.55, 0.22, fabricDeepMat, 0, 0.5, -0.37));
    sofa.add(box(0.22, 0.34, 0.95, fabricMat, -0.99, 0.55, 0));
    sofa.add(box(0.22, 0.34, 0.95, fabricMat, 0.99, 0.55, 0));
    sofa.position.set(3.4, 0, 1.4);
    sofa.rotation.y = -Math.PI / 2;
    root.add(sofa);
    const desk = new THREE.Group();
    desk.add(box(1.7, 0.06, 0.72, woodMat, 0, 0.74, 0));
    desk.add(box(0.07, 0.74, 0.66, woodDeepMat, -0.79, 0.37, 0));
    desk.add(box(0.07, 0.74, 0.66, woodDeepMat, 0.79, 0.37, 0));
    const screenMat = keep(
    // Literal, not COLORS.blueTint: the published @retrofit/design types still
    // predate the accent family, so the token does not typecheck from here.
    // Same value as --rf-blue-tint. TODO(contract): re-point once design ships it.
    new THREE.MeshStandardMaterial({ color: SCREEN_BLUE, emissive: new THREE.Color(SCREEN_BLUE), emissiveIntensity: 0.4, roughness: 1 }));
    desk.add(box(0.62, 0.38, 0.03, screenMat, 0, 0.98, -0.2));
    desk.add(box(0.66, 0.03, 0.42, metalMat, 0, 0.78, 0.02));
    desk.position.set(3.4, 0, -2.3);
    desk.rotation.y = -Math.PI / 2;
    root.add(desk);
    // The ceiling mount with nothing on it: the absence the page is about.
    const mountMat = keep(flat(COLORS.mutedTint));
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.015, 24), mountMat);
    mount.position.set(0, H - 0.01, -0.1);
    root.add(mount);
    const ringMat = keep(new THREE.MeshBasicMaterial({ color: COLORS.muted, transparent: true, opacity: 0.55 }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.2, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, H - 0.018, -0.1);
    root.add(ring);
    // Door frame on the open side, behind the camera's start.
    root.add(box(0.1, 2.05, 0.12, trimMat, 2.0, 1.02, D / 2 - 0.05));
    root.add(box(0.1, 2.05, 0.12, trimMat, 3.1, 1.02, D / 2 - 0.05));
    root.add(box(1.2, 0.1, 0.12, trimMat, 2.55, 2.05, D / 2 - 0.05));
    track(root);
    return {
        root,
        heater,
        anchors: {
            // `heater` and `fix` both read the live heater position; these two are
            // placeholders so the record stays total over AnchorId.
            heater: new THREE.Vector3(),
            fix: new THREE.Vector3(),
            curtain: new THREE.Vector3(-2.86, 1.9, -D / 2 + 0.14),
            detector: new THREE.Vector3(0, H - 0.05, -0.1),
            desk: new THREE.Vector3(3.15, 1.15, -2.3),
            bed: new THREE.Vector3(-3.6, 0.72, -1.0),
        },
        materials,
        geometries,
    };
}
/* -------------------------------------------------------------------------- */
/* The scene                                                                  */
/* -------------------------------------------------------------------------- */
export function createHouseScene(host, reducedMotion) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(COLORS.paper, FOG_ROOM[0], FOG_ROOM[1]);
    scene.fog = fog;
    const built = buildRoom();
    scene.add(built.root);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d3c4, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-3, 5, -6);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(5, 3, 6);
    scene.add(fill);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);
    const eyeCurve = new THREE.CatmullRomCurve3([...EYES], false, 'catmullrom', 0.5);
    const lookCurve = new THREE.CatmullRomCurve3([...LOOKS], false, 'catmullrom', 0.5);
    // The pipeline lives beyond the apartment on +x. It is invisible at
    // pipeline-progress 0, so it cannot show through the room's walls.
    const pipeline = buildPipeline();
    scene.add(pipeline.root);
    const started = performance.now();
    const badges = new Map();
    const eye = new THREE.Vector3();
    const look = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const camSpace = new THREE.Vector3();
    let target = 0;
    let current = 0;
    let needsRender = true;
    let width = 1;
    let height = 1;
    let raf = 0;
    let disposed = false;
    function resize() {
        const rect = host.getBoundingClientRect();
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        needsRender = true;
    }
    function placeBadges() {
        // Once the camera is out of the apartment the room's badges are pointing at
        // furniture nobody can see any more. Fade them with the exit, not with the
        // window they were authored in — `fix` runs to room-local 1.0 by design.
        const leaving = clamp01((current - ROOM_SPAN) / 0.05);
        const inRoom = 1 - leaving * leaving * (3 - 2 * leaving);
        for (const id of ANCHOR_IDS) {
            const el = badges.get(id);
            if (!el)
                continue;
            const anchor = id === 'heater' || id === 'fix' ? built.heater.position : built.anchors[id];
            const opacity = windowOpacity(clamp01(current / ROOM_SPAN), WINDOWS[id]) * inRoom;
            camSpace.copy(anchor).applyMatrix4(camera.matrixWorldInverse);
            if (opacity <= 0.001 || camSpace.z > -0.2) {
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
    function draw() {
        const t = clamp01(current);
        // Two clocks on one rail: the room's beats, then the pipeline's.
        const roomT = clamp01(t / ROOM_SPAN);
        const pipeT = clamp01((t - ROOM_SPAN) / (1 - ROOM_SPAN));
        eyeCurve.getPoint(t, eye);
        lookCurve.getPoint(t, look);
        camera.position.copy(eye);
        camera.lookAt(look);
        camera.updateMatrixWorld();
        // The fix: the last room beat slides the heater to the far wall, away from
        // fabric. Room-local, so extending the rail did not move it.
        const fix = clamp01((roomT - FIX_FROM) / (FIX_TO - FIX_FROM));
        const eased = fix * fix * (3 - 2 * fix);
        built.heater.position.lerpVectors(HEATER_PLACED, HEATER_MOVED, eased);
        built.heater.rotation.y = eased * Math.PI * 0.5;
        // The room's fog is tight enough to hide the pipeline entirely; open it as
        // the camera leaves, or nothing past the apartment ever renders.
        {
            const open = clamp01((pipeT - FOG_OPEN[0]) / (FOG_OPEN[1] - FOG_OPEN[0]));
            const fogEase = open * open * (3 - 2 * open);
            fog.near = FOG_ROOM[0] + (FOG_PIPE[0] - FOG_ROOM[0]) * fogEase;
            fog.far = FOG_ROOM[1] + (FOG_PIPE[1] - FOG_ROOM[1]) * fogEase;
        }
        pipeline.update(pipeT, (performance.now() - started) / 1000);
        renderer.render(scene, camera);
        placeBadges();
    }
    function tick() {
        if (disposed)
            return;
        raf = requestAnimationFrame(tick);
        // Self-heal: the host is `display: none` until the page flips to `--live`,
        // and a ResizeObserver notification for that transition is not guaranteed
        // to arrive. If we are still holding a degenerate buffer, measure again.
        if (width <= 1 || height <= 1)
            resize();
        const delta = target - current;
        if (Math.abs(delta) > 0.0002) {
            current += reducedMotion ? delta : delta * 0.12;
            needsRender = true;
        }
        else if (current !== target) {
            current = target;
            needsRender = true;
        }
        // The pipeline's particles run on a wall clock, not on scroll, so once it
        // is on screen every frame is a new frame whether or not progress moved.
        if (current > ROOM_SPAN - 0.02)
            needsRender = true;
        if (!needsRender)
            return;
        needsRender = false;
        draw();
    }
    resize();
    // The stage is `display: none` until the page flips to `--live`, which React
    // only does after this function returns — so the first `resize()` measures a
    // zero-sized host. The observer catches the real size the moment it exists,
    // and every later layout change with it.
    const observer = new ResizeObserver(() => resize());
    observer.observe(host);
    raf = requestAnimationFrame(tick);
    return {
        setProgress(t) {
            target = clamp01(t);
        },
        bindBadge(id, el) {
            if (el)
                badges.set(id, el);
            else
                badges.delete(id);
            needsRender = true;
        },
        resize,
        dispose() {
            disposed = true;
            observer.disconnect();
            cancelAnimationFrame(raf);
            for (const m of built.materials)
                m.dispose();
            for (const g of built.geometries)
                g.dispose();
            for (const m of pipeline.materials)
                m.dispose();
            for (const g of pipeline.geometries)
                g.dispose();
            renderer.dispose();
            if (renderer.domElement.parentNode === host)
                host.removeChild(renderer.domElement);
        },
    };
}
//# sourceMappingURL=tour-house.js.map