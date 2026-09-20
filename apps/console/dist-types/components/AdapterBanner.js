import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cssVar, RADIUS, SPACE } from '@retrofit/design';
import { useApi } from '../api/useApi.js';
/** Words carry the meaning; the glyph and colour are decoration (PRD §13). */
const COPY = {
    live: {
        label: 'Live Federato API',
        detail: 'Data is read from the live Federato API.',
        glyph: '●',
    },
    snapshot: {
        label: 'Snapshot',
        detail: 'Data is read from a saved Federato snapshot, not the live API.',
        glyph: '◐',
    },
    unknown: {
        label: 'Data source unknown',
        detail: 'The API health check has not answered.',
        glyph: '○',
    },
};
/** Visually hidden but read by screen readers (private; base.css belongs to C02). */
const srOnly = {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
};
const CHECKING = {
    label: 'Checking data source',
    detail: 'Reading GET /health.',
    glyph: '○',
};
/**
 * The phone kit's emphasis rule: live is bone with a 2px accent edge — the
 * "on" state, the same shape `Card tone="accent"` takes — and everything else
 * is a plain mute-tint fill. Amber and red are spoken for by the verdicts and
 * never appear here. The words say which source it is either way (PRD §13).
 */
function bannerStyle(kind) {
    const live = kind === 'live';
    return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: SPACE.sm,
        minHeight: 32,
        padding: `${SPACE.xs}px ${SPACE.md}px`,
        borderRadius: RADIUS.pill,
        border: live ? `2px solid ${cssVar('accent')}` : `1px solid ${cssVar('mute')}`,
        background: live ? cssVar('bone') : cssVar('mute-tint'),
        color: cssVar('ink'),
        fontFamily: cssVar('font-body'),
        fontSize: cssVar('size-micro'),
        lineHeight: cssVar('leading-micro'),
        fontWeight: 600,
        whiteSpace: 'nowrap',
    };
}
function BannerView({ kind, copy }) {
    return (_jsxs("div", { role: "status", "aria-live": "polite", "data-adapter": kind, title: copy.detail, style: bannerStyle(kind), children: [_jsx("span", { "aria-hidden": "true", children: copy.glyph }), _jsxs("span", { children: [_jsx("span", { style: srOnly, children: "Data source: " }), copy.label] })] }));
}
/** Reads GET /health through the shared API client. */
function HealthBanner() {
    const health = useApi((client) => client.health(), []);
    if (health.data) {
        const kind = health.data.adapter === 'live' ? 'live' : 'snapshot';
        return _jsx(BannerView, { kind: kind, copy: COPY[kind] });
    }
    if (health.loading)
        return _jsx(BannerView, { kind: "unknown", copy: CHECKING });
    return _jsx(BannerView, { kind: "unknown", copy: COPY.unknown });
}
/**
 * PRD §10 header: "Banner: live Federato or snapshot. Never hidden."
 *
 * The banner states the adapter in words ("Live Federato API" / "Snapshot"),
 * never by colour alone, and has role="status" so a screen reader announces a
 * change. It renders something in every state — loading, error and unknown
 * included — so it can never disappear from the header.
 */
export function AdapterBanner(props) {
    if (props.kind !== undefined)
        return _jsx(BannerView, { kind: props.kind, copy: COPY[props.kind] });
    return _jsx(HealthBanner, {});
}
//# sourceMappingURL=AdapterBanner.js.map