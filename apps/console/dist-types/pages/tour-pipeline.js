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
import { COLORS, FONT_STACKS, VERDICT_STYLES } from '@retrofit/design';
/* -------------------------------------------------------------------------- */
/* Tuning — every number chosen by eye lives in this block                    */
/* -------------------------------------------------------------------------- */
/** Where each thing sits. The apartment occupies x∈[-5,5], z∈[-3.5,3.5]. */
const APARTMENT_POS = new THREE.Vector3(0, 1.5, 0);
/** A hair larger than the room, so the outline never z-fights its walls. */
const APARTMENT_SIZE = new THREE.Vector3(10.2, 3, 7.2);
const APARTMENT_LABEL_Y = 4.2;
const FEDERATO_POS = new THREE.Vector3(0, 1.5, -20);
const FEDERATO_SIZE = new THREE.Vector3(10, 3, 7);
const SHELL_POS = new THREE.Vector3(34, 3, -10);
const SHELL_SIZE = new THREE.Vector3(16, 12, 12);
const CORE_RADIUS = 4;
/** Six concentric rings. The outermost pokes ~0.4 past the open shell face. */
const RING_R0 = 4.6;
const RING_STEP = 0.36;
const RING_TUBE = 0.05;
const RING_RADIAL_SEGMENTS = 6;
const RING_TUBULAR_SEGMENTS = 48;
const CONSOLE_POS = new THREE.Vector3(62, 3, -4);
const PHONE_POS = new THREE.Vector3(62, 3, -16);
const OUTPUT_SIZE = new THREE.Vector3(6, 3, 5);
/**
 * What each surface *is*, drawn rather than written. The two boxes are the
 * only thing in the scene a non-engineer recognises, and an empty box is a
 * box — so the console gets a ranked book on a screen and the phone gets a
 * handset with a verdict on it, both as flat line art standing proud of the
 * node's +z face (the side the final camera position looks at).
 */
const GLYPH_Z = OUTPUT_SIZE.z / 2 + 0.06;
/** Console screen: a header bar and five ranked rows. */
const SCREEN_SIZE = { w: 4.6, h: 2.2 };
const SCREEN_ROWS = 5;
/** Score-bar length as a fraction of the row's track, top row first. */
const SCREEN_BARS = [0.94, 0.78, 0.6, 0.41, 0.24];
/** Phone handset: body, screen, one verdict chip, a price bar, two fix rows. */
const PHONE_BODY = { w: 1.5, h: 2.7 };
const PHONE_BEZEL = 0.16;
/** Fix-step row lengths as a fraction of the screen width. */
const PHONE_FIX_ROWS = [0.82, 0.55];
/** Ramp windows. `ramp(t, a, b)` is a smoothstep from a to b. */
const W_ROOT_VISIBLE = 0.02;
const W_APARTMENT = [0.05, 0.3];
const W_FEDERATO = [0.13, 0.35];
const W_STREAM = [0.14, 0.4];
const W_SHELL = [0.3, 0.55];
const W_EDGE_LABEL = [0.33, 0.5];
const W_CORE = [0.42, 0.62];
const W_OUTPUT = [0.7, 0.88];
const W_DETAIL = [0.8, 0.96];
/** Ring i ignites as t crosses RING_IGNITE_FROM + (i/6)*RING_IGNITE_SPAN. */
const RING_IGNITE_FROM = 0.5;
const RING_IGNITE_SPAN = 0.25;
const RING_IGNITE_EASE = 0.05;
/** Particles. `u` is curve parameter; speed is u per second. */
const PARTICLES_PER_STREAM = 300;
const PARTICLE_SIZE = 0.17;
/** How far down the path particles may exist: 0.26 of the way at first, all of it by W_STREAM[1]. */
const REACH_MIN = 0.26;
/** Fraction of the live length over which particles fade out at the head. */
const REACH_TAIL = 0.3;
const STREAM_SPEED = [0.115, 0.095];
/** Result cards: card i leaves the shell at CARD_FROM + i*CARD_STAGGER. */
const CARD_FROM = 0.72;
const CARD_STAGGER = 0.05;
const CARD_SPAN = 0.2;
/** Cards depart the shell's +x face and land just short of their output node. */
const CARD_ORIGIN = new THREE.Vector3(40, 3, -10);
const CARD_BOB = 0.25;
const RING_LABELS = [
    'normalize',
    'rollup',
    'merge',
    'vectorize',
    'evaluate',
    'price + verdict',
];
/** Idle rotation of each ring, radians per second. Slow on purpose. */
const RING_SPIN = [0.031, -0.044, 0.038, -0.028, 0.051, -0.035];
/** Fixed tilts, so six near-identical radii still read as six rings. */
const RING_TILT_X = [0.06, -0.14, 0.22, -0.27, 0.12, -0.33];
const RING_TILT_Z = [-0.2, 0.11, -0.08, 0.24, -0.3, 0.16];
/* -------------------------------------------------------------------------- */
/* Small private helpers                                                      */
/* -------------------------------------------------------------------------- */
/**
 * The accent family, inlined — same values as `COLORS.blue*`.
 *
 * The published `@retrofit/design` declarations still predate the accent
 * family, so `COLORS.blue` does not typecheck from here. `tour-house.ts`
 * carries the identical workaround for `--rf-blue-tint`.
 * TODO(contract): re-point these at the tokens once design ships them.
 */
const BLUE = '#2C6E9E';
const BLUE_DEEP = '#1D3557';
const BLUE_TINT = '#E4EAF1';
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smoothstep from `a` to `b`. 0 at or below `a`, 1 at or above `b`. */
function ramp(t, a, b) {
    const x = clamp01((t - a) / (b - a));
    return x * x * (3 - 2 * x);
}
const LABEL_W = 512;
const LABEL_H = 128;
/**
 * `tour-house.ts` has no sprite helper, so this file writes one (and exports
 * it, below, so the room can use the same labels the pipeline does).
 *
 * Every label here is a billboarded `THREE.Sprite` with a canvas texture —
 * text painted onto a plane skews with perspective and this scene flies past
 * everything at an angle. The canvas is offscreen: no element is ever attached
 * to the document. Where there is no 2D context at all (jsdom), the sprite is
 * still created, just untextured, so the object graph is the same shape in a
 * test as it is in a browser.
 */
function makeLabelCanvas() {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const c = document.createElement('canvas');
        c.width = LABEL_W;
        c.height = LABEL_H;
        return c;
    }
    if (typeof OffscreenCanvas !== 'undefined')
        return new OffscreenCanvas(LABEL_W, LABEL_H);
    return null;
}
function paintLabel(ctx, text, style) {
    ctx.clearRect(0, 0, LABEL_W, LABEL_H);
    const pad = 14;
    if (style.fill !== undefined || style.border !== undefined) {
        const r = 22;
        ctx.beginPath();
        ctx.moveTo(pad + r, pad);
        ctx.arcTo(LABEL_W - pad, pad, LABEL_W - pad, LABEL_H - pad, r);
        ctx.arcTo(LABEL_W - pad, LABEL_H - pad, pad, LABEL_H - pad, r);
        ctx.arcTo(pad, LABEL_H - pad, pad, pad, r);
        ctx.arcTo(pad, pad, LABEL_W - pad, pad, r);
        ctx.closePath();
        if (style.fill !== undefined && style.fill !== 'transparent') {
            ctx.fillStyle = style.fill;
            ctx.fill();
        }
        if (style.border !== undefined) {
            ctx.strokeStyle = style.border;
            ctx.lineWidth = 5;
            ctx.stroke();
        }
    }
    ctx.font = `${style.weight ?? 500} ${style.fontPx ?? 56}px ${FONT_STACKS.body}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = style.color ?? COLORS.ink;
    ctx.fillText(text, LABEL_W / 2, LABEL_H / 2 + 2, LABEL_W - pad * 4);
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
export function pipelineLabel(text, opts = {}) {
    const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 1 });
    const canvas = makeLabelCanvas();
    const ctx = canvas === null ? null : canvas.getContext('2d');
    if (canvas !== null && ctx !== null) {
        paintLabel(ctx, text, opts);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        mat.map = tex;
        // `Material.dispose()` does not free its maps. Wrap it so the caller's one
        // sweep over `materials` frees the texture too and nothing leaks.
        const base = mat.dispose.bind(mat);
        mat.dispose = () => {
            tex.dispose();
            base();
        };
    }
    const width = opts.size ?? 4;
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(width, (width * LABEL_H) / LABEL_W, 1);
    return sprite;
}
export function buildPipeline() {
    const root = new THREE.Group();
    const materials = [];
    const geometries = [];
    const fades = [];
    const keep = (m) => {
        materials.push(m);
        return m;
    };
    const keepGeo = (g) => {
        geometries.push(g);
        return g;
    };
    const fade = (m, a, b, max) => {
        m.transparent = true;
        m.opacity = 0;
        fades.push({ m, a, b, max });
        return m;
    };
    /** `pipelineLabel`, with the material registered for the caller to dispose. */
    function label(text, worldWidth, style) {
        const sprite = pipelineLabel(text, { ...style, size: worldWidth });
        sprite.material.opacity = 0;
        keep(sprite.material);
        return sprite;
    }
    /**
     * A closed volume: a low-opacity paper fill so it reads solid against the
     * paper background, plus crisp ink edges. Deliberately no internal
     * subdivision — a grid on the faces reads as noise at this distance.
     */
    function volume(size, pos, a, b) {
        const group = new THREE.Group();
        group.position.copy(pos);
        const geo = keepGeo(new THREE.BoxGeometry(size.x, size.y, size.z));
        const fillMat = fade(new THREE.MeshBasicMaterial({ color: COLORS.paper, depthWrite: false }), a, b, 0.62);
        group.add(new THREE.Mesh(geo, keep(fillMat)));
        const edgeGeo = keepGeo(new THREE.EdgesGeometry(geo));
        const edgeMat = fade(new THREE.LineBasicMaterial({ color: COLORS.ink }), a, b, 0.9);
        group.add(new THREE.LineSegments(edgeGeo, keep(edgeMat)));
        return group;
    }
    /* ---------------------------------------------------------------- sources */
    // The first front door, drawn around the room the camera just left. Outline
    // only, never a fill: the real room geometry lives inside this box and has to
    // stay readable through it.
    const apartmentGeo = keepGeo(new THREE.BoxGeometry(APARTMENT_SIZE.x, APARTMENT_SIZE.y, APARTMENT_SIZE.z));
    const apartmentEdges = keepGeo(new THREE.EdgesGeometry(apartmentGeo));
    const apartmentMat = fade(new THREE.LineBasicMaterial({ color: COLORS.ink }), W_APARTMENT[0], W_APARTMENT[1], 0.9);
    const apartment = new THREE.LineSegments(apartmentEdges, keep(apartmentMat));
    apartment.position.copy(APARTMENT_POS);
    root.add(apartment);
    const apartmentLabel = label('iPhone sweep', 5.0, { color: COLORS.ink, weight: 600 });
    apartmentLabel.position.set(APARTMENT_POS.x, APARTMENT_LABEL_Y, APARTMENT_POS.z);
    fade(apartmentLabel.material, W_APARTMENT[0], W_APARTMENT[1], 1);
    root.add(apartmentLabel);
    // The second front door. Same footprint and visual weight as the apartment.
    const federato = volume(FEDERATO_SIZE, FEDERATO_POS, W_FEDERATO[0], W_FEDERATO[1]);
    const federatoLabel = label('Federato API', 5.4, { color: COLORS.ink, weight: 600 });
    federatoLabel.position.set(0, FEDERATO_SIZE.y / 2 + 1.1, 0);
    fade(federatoLabel.material, W_FEDERATO[0], W_FEDERATO[1], 1);
    federato.add(federatoLabel);
    root.add(federato);
    /* ------------------------------------------------------------------ shell */
    // `apps/api` is an open wireframe: it contains the engine, it does not hide it.
    const shellGeo = keepGeo(new THREE.BoxGeometry(SHELL_SIZE.x, SHELL_SIZE.y, SHELL_SIZE.z));
    const shellEdges = keepGeo(new THREE.EdgesGeometry(shellGeo));
    const shellMat = fade(new THREE.LineBasicMaterial({ color: COLORS.ink }), W_SHELL[0], W_SHELL[1], 0.55);
    const shell = new THREE.LineSegments(shellEdges, keep(shellMat));
    shell.position.copy(SHELL_POS);
    root.add(shell);
    const shellLabel = label('apps/api', 4.6, { color: COLORS.mutedDeep, weight: 600 });
    shellLabel.position.set(SHELL_POS.x, SHELL_POS.y + SHELL_SIZE.y / 2 + 1.2, SHELL_POS.z);
    fade(shellLabel.material, W_SHELL[0], W_SHELL[1], 1);
    root.add(shellLabel);
    /* ------------------------------------------------------------------- core */
    const coreGroup = new THREE.Group();
    coreGroup.position.copy(SHELL_POS);
    root.add(coreGroup);
    const icoGeo = keepGeo(new THREE.IcosahedronGeometry(CORE_RADIUS, 1));
    const coreFill = fade(new THREE.MeshBasicMaterial({ color: BLUE_TINT, depthWrite: false }), W_CORE[0], W_CORE[1], 0.55);
    const coreMesh = new THREE.Mesh(icoGeo, keep(coreFill));
    coreGroup.add(coreMesh);
    const icoEdges = keepGeo(new THREE.EdgesGeometry(icoGeo));
    const coreEdgeMat = fade(new THREE.LineBasicMaterial({ color: COLORS.blue }), W_CORE[0], W_CORE[1], 0.95);
    coreGroup.add(new THREE.LineSegments(icoEdges, keep(coreEdgeMat)));
    const coreLabel = label('packages/engine', 5.2, { color: BLUE_DEEP, weight: 600 });
    coreLabel.position.set(0, CORE_RADIUS + 0.9, 0);
    fade(coreLabel.material, W_CORE[0], W_CORE[1], 1);
    coreGroup.add(coreLabel);
    /* ------------------------------------------------------------------ rings */
    const rings = [];
    for (let i = 0; i < 6; i += 1) {
        const r = RING_R0 + i * RING_STEP;
        const group = new THREE.Group();
        const geo = keepGeo(new THREE.TorusGeometry(r, RING_TUBE, RING_RADIAL_SEGMENTS, RING_TUBULAR_SEGMENTS));
        const mat = keep(new THREE.MeshBasicMaterial({ color: COLORS.muted, transparent: true, opacity: 0, depthWrite: false }));
        const mesh = new THREE.Mesh(geo, mat);
        // A torus is born in the XY plane; lay it flat so the ring's own tilt is
        // the only thing that lifts it, and the stack stays inside the shell.
        mesh.rotation.x = -Math.PI / 2;
        group.add(mesh);
        // Six labels on one axis collapse into an unreadable stack the moment the
        // camera is anywhere but dead-on. Spread them across a wide arc AND step
        // them in y, so no two can overlap from any angle the rail actually visits.
        const theta = Math.PI * 0.60 + (i / 5) * Math.PI * 0.80;
        const sprite = label(RING_LABELS[i] ?? '', 2.6, { color: BLUE_DEEP, weight: 500, fontPx: 50 });
        sprite.position.set(Math.cos(theta) * (r + 1.5), (i - 2.5) * 0.95, Math.sin(theta) * (r + 1.5));
        const labelMat = sprite.material;
        group.add(sprite);
        coreGroup.add(group);
        rings.push({
            group,
            mat,
            labelMat,
            ignite: RING_IGNITE_FROM + (i / 6) * RING_IGNITE_SPAN,
            spin: RING_SPIN[i] ?? 0.03,
        });
    }
    /* ---------------------------------------------------------------- outputs */
    /**
     * Flat line art on the node's front face. `plate` is a filled rectangle,
     * `outline` is the same rectangle as ink edges; both live in the XY plane at
     * `GLYPH_Z`, both fade on the glyph window so the box reads first.
     */
    function plate(w, h, x, y, color, max) {
        const geo = keepGeo(new THREE.PlaneGeometry(w, h));
        const mat = fade(new THREE.MeshBasicMaterial({ color, depthWrite: false, side: THREE.DoubleSide }), W_DETAIL[0], W_DETAIL[1], max);
        const mesh = new THREE.Mesh(geo, keep(mat));
        mesh.position.set(x, y, GLYPH_Z);
        return mesh;
    }
    function outline(w, h, x, y, color, max) {
        // The source plane is registered too: EdgesGeometry copies it, it is never
        // drawn, and an unregistered geometry is a leak the caller cannot reach.
        const geo = keepGeo(new THREE.EdgesGeometry(keepGeo(new THREE.PlaneGeometry(w, h))));
        const mat = fade(new THREE.LineBasicMaterial({ color }), W_DETAIL[0], W_DETAIL[1], max);
        const lines = new THREE.LineSegments(geo, keep(mat));
        lines.position.set(x, y, GLYPH_Z + 0.01);
        return lines;
    }
    /** The console's glyph: a screen holding a ranked book, longest bar on top. */
    function consoleGlyph() {
        const g = new THREE.Group();
        const { w, h } = SCREEN_SIZE;
        g.add(plate(w, h, 0, 0, COLORS.paper, 0.9));
        g.add(outline(w, h, 0, 0, COLORS.ink, 0.85));
        // Header bar, then a rule under it: this is a table, not a picture.
        const headH = 0.3;
        g.add(plate(w - 0.18, headH, 0, h / 2 - headH / 2 - 0.09, BLUE_TINT, 0.95));
        g.add(plate(w - 0.18, 0.02, 0, h / 2 - headH - 0.09, COLORS.ink, 0.5));
        const rowH = (h - headH - 0.3) / SCREEN_ROWS;
        const trackX = -w / 2 + 0.5;
        const trackW = w - 0.95;
        for (let i = 0; i < SCREEN_ROWS; i += 1) {
            const y = h / 2 - headH - 0.2 - rowH * (i + 0.5);
            // Rank chip on the left, score bar filling the rest of the row.
            g.add(plate(0.2, 0.2, -w / 2 + 0.26, y, COLORS.mutedDeep, 0.65));
            const barW = trackW * (SCREEN_BARS[i] ?? 0.3);
            // The top row is the live one: full ink weight, the rest step back.
            g.add(plate(barW, 0.11, trackX + barW / 2, y, i === 0 ? BLUE_DEEP : BLUE, 0.9 - i * 0.12));
        }
        return g;
    }
    /** The phone's glyph: a handset showing one verdict, a price, and the fix. */
    function phoneGlyph() {
        const g = new THREE.Group();
        const { w, h } = PHONE_BODY;
        const sw = w - PHONE_BEZEL * 2;
        g.add(plate(w, h, 0, 0, COLORS.paper, 0.9));
        g.add(outline(w, h, 0, 0, COLORS.ink, 0.85));
        g.add(outline(sw, h - PHONE_BEZEL * 3.2, 0, -PHONE_BEZEL * 0.6, COLORS.muted, 0.6));
        // Earpiece slot, so the rectangle reads as a handset and not a card.
        g.add(plate(0.34, 0.05, 0, h / 2 - PHONE_BEZEL * 0.7, COLORS.mutedDeep, 0.7));
        // Verdict chip — the one red thing on the glyph, matching the cards.
        const chipY = h / 2 - 0.72;
        g.add(plate(sw - 0.1, 0.36, 0, chipY, VERDICT_STYLES.FIT.fill, 0.95));
        // The dollar estimate: one heavy bar, then a light one under it.
        g.add(plate(sw - 0.4, 0.16, 0, chipY - 0.52, BLUE_DEEP, 0.9));
        g.add(plate(sw - 0.75, 0.08, 0, chipY - 0.75, COLORS.muted, 0.7));
        // The fix: a short checklist near the bottom of the screen.
        PHONE_FIX_ROWS.forEach((frac, i) => {
            const y = -h / 2 + 0.62 - i * 0.26;
            g.add(plate(0.12, 0.12, -sw / 2 + 0.1, y, BLUE, 0.85));
            g.add(plate((sw - 0.34) * frac, 0.08, -sw / 2 + 0.26 + ((sw - 0.34) * frac) / 2, y, COLORS.muted, 0.75));
        });
        return g;
    }
    /** One output node: the box, its name, and the drawn thing it stands for. */
    function output(pos, name, glyph) {
        const node = volume(OUTPUT_SIZE, pos, W_OUTPUT[0], W_OUTPUT[1]);
        const title = label(name, 4.2, { color: COLORS.ink, weight: 600 });
        title.position.set(0, OUTPUT_SIZE.y / 2 + 1.0, 0);
        fade(title.material, W_OUTPUT[0], W_OUTPUT[1], 1);
        node.add(title);
        node.add(glyph);
        root.add(node);
        return node;
    }
    output(CONSOLE_POS, 'Console', consoleGlyph());
    output(PHONE_POS, 'Phone', phoneGlyph());
    /* ---------------------------------------------------------------- streams */
    // Both paths curve up out of their source and fall into the shell's centre.
    const streamSpecs = [
        {
            // The apartment. Starts at the room's open +x side, at eye height.
            pts: [
                new THREE.Vector3(5, 1.4, 0),
                new THREE.Vector3(13, 3.4, -1.6),
                new THREE.Vector3(22, 4.4, -5),
                new THREE.Vector3(30, 3.6, -8.6),
                SHELL_POS.clone(),
            ],
            label: 'photos + bearings',
        },
        {
            // The Federato box.
            pts: [
                new THREE.Vector3(5, 1.5, -20),
                new THREE.Vector3(14, 2.3, -19.2),
                new THREE.Vector3(24, 3.2, -16),
                new THREE.Vector3(31, 3.2, -12.4),
                SHELL_POS.clone(),
            ],
            label: 'records + query trace',
        },
    ];
    const streams = [];
    const labelAt = new THREE.Vector3();
    streamSpecs.forEach((spec, i) => {
        const curve = new THREE.CatmullRomCurve3([...spec.pts], false, 'catmullrom', 0.5);
        const geo = keepGeo(new THREE.BufferGeometry());
        const position = new THREE.BufferAttribute(new Float32Array(PARTICLES_PER_STREAM * 3), 3);
        // Four components: three.js reads the fourth as per-vertex alpha, which is
        // how one draw call can hold a stream that thins out along its own length.
        const color = new THREE.BufferAttribute(new Float32Array(PARTICLES_PER_STREAM * 4), 4);
        position.setUsage(THREE.DynamicDrawUsage);
        color.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', position);
        geo.setAttribute('color', color);
        const mat = keep(new THREE.PointsMaterial({
            size: PARTICLE_SIZE,
            sizeAttenuation: true,
            transparent: true,
            depthWrite: false,
            vertexColors: true,
        }));
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        root.add(points);
        // Deterministic phases: the golden-ratio sequence spaces them evenly
        // without a PRNG, so two runs of the page look identical.
        const phases = new Float32Array(PARTICLES_PER_STREAM);
        for (let p = 0; p < PARTICLES_PER_STREAM; p += 1) {
            phases[p] = (p * 0.6180339887498949 + i * 0.37) % 1;
        }
        const sprite = label(spec.label, 5.0, { color: COLORS.blue, weight: 500, fontPx: 48 });
        curve.getPoint(0.55, labelAt);
        sprite.position.set(labelAt.x, labelAt.y + 1.4, labelAt.z);
        fade(sprite.material, W_EDGE_LABEL[0], W_EDGE_LABEL[1], 1);
        root.add(sprite);
        streams.push({
            curve,
            points,
            mat,
            position,
            color,
            phases,
            speed: STREAM_SPEED[i] ?? 0.1,
            rgb: new THREE.Color(COLORS.blue),
        });
    });
    /* ------------------------------------------------------------------ cards */
    // The only red in this file. Red is reserved for verdicts, and these are
    // verdicts, so they take VERDICT_STYLES verbatim.
    const cardSpecs = [
        { text: 'FIT 94', style: VERDICT_STYLES.FIT, target: CONSOLE_POS },
        { text: 'REFER 71', style: VERDICT_STYLES.REFER, target: CONSOLE_POS },
        { text: 'DOES_NOT_FIT', style: VERDICT_STYLES.DOES_NOT_FIT, target: PHONE_POS },
    ];
    const cards = cardSpecs.map((spec, i) => {
        const sprite = label(spec.text, 4.4, {
            color: spec.style.text,
            fill: spec.style.fill,
            border: spec.style.border,
            weight: 700,
            fontPx: spec.text.length > 9 ? 46 : 56,
        });
        sprite.position.copy(CARD_ORIGIN);
        root.add(sprite);
        return {
            sprite,
            mat: sprite.material,
            // Land just short of the output's -x face, one card above the other.
            // Stand them off the node in +z as well as -x: at the last beat the two
            // output nodes project close together, and stacking cards on the node
            // itself put all three on top of each other and on top of its label.
            target: new THREE.Vector3(spec.target.x - 5.6, spec.target.y + 1.2 + (i % 2) * 2.2, spec.target.z + 5.0 + i * 1.2),
            from: CARD_FROM + i * CARD_STAGGER,
            phase: i * 1.7,
        };
    });
    /* -------------------------------------------------------------------------- */
    /* Update — pure in (t, elapsed), and allocation-free                         */
    /* -------------------------------------------------------------------------- */
    const scratch = new THREE.Vector3();
    const litColor = new THREE.Color(COLORS.blue);
    const dimColor = new THREE.Color(COLORS.muted);
    const ringColor = new THREE.Color();
    function update(t, elapsed) {
        // A cheap early-out only. Every part still holds its own ramp, so the
        // first thing to appear — the outline around the apartment — is already at
        // opacity 0 until t reaches W_APARTMENT[0], and the rest of the pipeline
        // stays invisible through the walls well past that.
        root.visible = t > W_ROOT_VISIBLE;
        if (!root.visible)
            return;
        for (let i = 0; i < fades.length; i += 1) {
            const f = fades[i];
            if (f === undefined)
                continue;
            f.m.opacity = ramp(t, f.a, f.b) * f.max;
        }
        // Core: prominent from 0.42, with a slow breath that never stops.
        const core = ramp(t, W_CORE[0], W_CORE[1]);
        const breath = 1 + 0.02 * Math.sin(elapsed * 1.15);
        const coreScale = (0.82 + 0.18 * core) * breath;
        coreGroup.scale.setScalar(coreScale);
        // Rings: each ignites on its own crossing of t, and drifts on `elapsed`.
        for (let i = 0; i < rings.length; i += 1) {
            const ring = rings[i];
            if (ring === undefined)
                continue;
            const lit = ramp(t, ring.ignite, ring.ignite + RING_IGNITE_EASE);
            ringColor.copy(dimColor).lerp(litColor, lit);
            ring.mat.color.copy(ringColor);
            ring.mat.opacity = core * (0.18 + 0.72 * lit);
            ring.labelMat.opacity = lit * Math.min(1, core * 1.4);
            ring.group.rotation.set(RING_TILT_X[i] ?? 0, elapsed * ring.spin + i * 0.9, RING_TILT_Z[i] ?? 0);
            const swell = 1 + 0.06 * lit;
            ring.group.scale.setScalar(swell);
        }
        // Streams. How bright they are is `t`; how far along the path a particle
        // is allowed to exist is `t`; where it actually is, is `elapsed`.
        const streamOpacity = ramp(t, W_STREAM[0], W_STREAM[1]);
        const reach = REACH_MIN + (1 - REACH_MIN) * ramp(t, W_STREAM[0], W_STREAM[1]);
        for (let s = 0; s < streams.length; s += 1) {
            const stream = streams[s];
            if (stream === undefined)
                continue;
            const pos = stream.position.array;
            const col = stream.color.array;
            const drift = elapsed * stream.speed;
            const tail = reach * REACH_TAIL;
            for (let p = 0; p < PARTICLES_PER_STREAM; p += 1) {
                const phase = stream.phases[p] ?? 0;
                let u = (phase + drift) % 1;
                if (u < 0)
                    u += 1;
                stream.curve.getPoint(u, scratch);
                const o = p * 3;
                pos[o] = scratch.x;
                pos[o + 1] = scratch.y;
                pos[o + 2] = scratch.z;
                // Fade in off the source, fade out before the front of the live length.
                const head = clamp01(u / 0.05);
                const dying = clamp01((reach - u) / tail);
                const shape = head * (dying * dying * (3 - 2 * dying));
                const c = p * 4;
                col[c] = stream.rgb.r;
                col[c + 1] = stream.rgb.g;
                col[c + 2] = stream.rgb.b;
                col[c + 3] = streamOpacity * shape;
            }
            stream.position.needsUpdate = true;
            stream.color.needsUpdate = true;
            stream.mat.opacity = streamOpacity > 0 ? 1 : 0;
            stream.points.visible = streamOpacity > 0.001;
        }
        // Cards: one smoothstep each from the shell to its output, and they stay
        // put once landed. Scrub back and they fly home.
        for (let i = 0; i < cards.length; i += 1) {
            const card = cards[i];
            if (card === undefined)
                continue;
            const travel = ramp(t, card.from, card.from + CARD_SPAN);
            scratch.copy(CARD_ORIGIN).lerp(card.target, travel);
            card.sprite.position.set(scratch.x, scratch.y + CARD_BOB * Math.sin(elapsed * 1.1 + card.phase) * (1 - travel * 0.6), scratch.z);
            card.mat.opacity = ramp(t, card.from, card.from + CARD_SPAN * 0.35);
            card.sprite.visible = card.mat.opacity > 0.001;
        }
    }
    // Draw the very first frame from the same code path, so nothing is ever in a
    // build-time-only state.
    update(0, 0);
    return { root, update, materials, geometries };
}
//# sourceMappingURL=tour-pipeline.js.map