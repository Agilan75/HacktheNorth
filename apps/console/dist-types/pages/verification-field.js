/*
 * The layer A+B field, without React: decoding the one-byte-per-case files
 * `packages/verify/src/scripts/record-field.ts` wrote, ordering the cases, and
 * painting them one pixel each. Kept apart from the component so it can be
 * tested without a canvas.
 */
export const COLOR_BY = ['verdict', 'factor', 'score'];
export const verdictOf = (byte) => byte & 3;
export const factorOf = (byte) => (byte >> 2) & 15;
export const isFromSubmission = (byte) => (byte & 64) !== 0;
export const isOnThreshold = (byte) => (byte & 128) !== 0;
export const SURFACE = '#FAF8F2';
/** PRD 13 verdict colours: FIT red, REFER amber, DOES_NOT_FIT ink. Always shown with the word and the count. */
export const VERDICT_COLORS = ['#E4002B', '#EDA100', '#1F1E1B'];
/** "No deciding factor" in neutral grey, then the eight factors in fixed categorical order. */
export const FACTOR_COLORS = [
    '#B9B8B0',
    '#2a78d6',
    '#eb6834',
    '#1baf7a',
    '#eda100',
    '#e87ba4',
    '#008300',
    '#4a3aa7',
    '#e34948',
];
/** One hue, light to dark, for the 0..100 appetite score. */
const SCORE_FROM = [0x86, 0xb6, 0xef];
const SCORE_TO = [0x0d, 0x36, 0x6b];
function rgb(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Little-endian RGBA as one uint32, the layout of `ImageData`'s buffer. */
function pack(r, g, b) {
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
const WASH = 0.86;
function washed(c) {
    const s = rgb(SURFACE);
    return pack(Math.round(c[0] + (s[0] - c[0]) * WASH), Math.round(c[1] + (s[1] - c[1]) * WASH), Math.round(c[2] + (s[2] - c[2]) * WASH));
}
export function scoreColor(score) {
    const t = Math.max(0, Math.min(100, score)) / 100;
    return [
        Math.round(SCORE_FROM[0] + (SCORE_TO[0] - SCORE_FROM[0]) * t),
        Math.round(SCORE_FROM[1] + (SCORE_TO[1] - SCORE_FROM[1]) * t),
        Math.round(SCORE_FROM[2] + (SCORE_TO[2] - SCORE_FROM[2]) * t),
    ];
}
export function cssColor(c) {
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}
/** The colour table for a mode: full-strength and washed, indexed by the mode's key. */
function palette(colorBy) {
    const colors = colorBy === 'verdict'
        ? VERDICT_COLORS.map(rgb)
        : colorBy === 'factor'
            ? FACTOR_COLORS.map(rgb)
            : Array.from({ length: 101 }, (_, s) => scoreColor(s));
    return {
        full: Uint32Array.from(colors, (c) => pack(c[0], c[1], c[2])),
        dim: Uint32Array.from(colors, washed),
    };
}
/** The byte the current colour mode reads for case `i`. */
function keyAt(layers, colorBy, i) {
    if (colorBy === 'verdict')
        return verdictOf(layers.cases[i]);
    if (colorBy === 'factor')
        return factorOf(layers.cases[i]);
    return layers.scores === null ? 0 : layers.scores[i];
}
/**
 * Pixel position -> case index with like cases together (a stable counting
 * sort on the colour key, so run order is kept inside each band).
 */
export function groupedOrder(layers, colorBy) {
    const total = layers.cases.length;
    const buckets = colorBy === 'verdict' ? 3 : colorBy === 'factor' ? 16 : 101;
    const starts = new Uint32Array(buckets + 1);
    for (let i = 0; i < total; i++)
        starts[keyAt(layers, colorBy, i) + 1]++;
    for (let b = 0; b < buckets; b++)
        starts[b + 1] += starts[b];
    const order = new Uint32Array(total);
    for (let i = 0; i < total; i++)
        order[starts[keyAt(layers, colorBy, i)]++] = i;
    return order;
}
function highlighted(layers, highlight, i) {
    switch (highlight.kind) {
        case 'none':
            return true;
        case 'threshold':
            return isOnThreshold(layers.cases[i]);
        case 'submission':
            return isFromSubmission(layers.cases[i]);
        case 'stratum':
            return layers.strata !== null && layers.strata[i] === highlight.index;
    }
}
/** Side of the square that holds `total` pixels. */
export function fieldSide(total) {
    return Math.ceil(Math.sqrt(total));
}
/** Paints every case into `out` (a `side * side` RGBA buffer viewed as uint32), row-major in `order`. */
export function paintField(out, layers, order, colorBy, highlight) {
    const { full, dim } = palette(colorBy);
    const total = layers.cases.length;
    const all = highlight.kind === 'none';
    for (let p = 0; p < total; p++) {
        const i = order === null ? p : order[p];
        const key = keyAt(layers, colorBy, i);
        out[p] = all || highlighted(layers, highlight, i) ? full[key] : dim[key];
    }
    out.fill(0, total);
}
/** A random case that passes `test`, or null when none turned up. */
export function randomCase(total, test, random = Math.random) {
    for (let tries = 0; tries < 400_000; tries++) {
        const i = Math.floor(random() * total);
        if (test(i))
            return i;
    }
    return null;
}
//# sourceMappingURL=verification-field.js.map