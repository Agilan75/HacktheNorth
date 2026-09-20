import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink } from 'react-router';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';
const MAIN_ID = 'rf-main';
const shellStyle = {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: cssVar('bone'),
    color: cssVar('ink'),
    fontFamily: cssVar('font-body'),
};
const skipLinkStyle = {
    position: 'absolute',
    left: SPACE.lg,
    top: -100,
    padding: SPACE.sm,
    background: cssVar('ink'),
    color: cssVar('bone'),
    borderRadius: RADIUS.card,
    zIndex: 20,
};
/**
 * Sticky, because the adapter banner rides in it and PRD §10 says the banner
 * is never hidden — scrolling a long queue should not take it off screen.
 */
const headerStyle = {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACE.lg,
    padding: `${SPACE.md}px ${SPACE.xl}px`,
    minWidth: 0,
    borderBottom: `1px solid ${cssVar('mute-tint')}`,
    background: cssVar('bone'),
};
const navListStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: SPACE.xs,
    listStyle: 'none',
    margin: 0,
    padding: 0,
};
/**
 * The phone kit's ChoiceGroup, in a header: the one you are on fills with ink
 * and flips to bone words. Weight and `aria-current` say the same thing, so
 * colour is never the only signal (PRD §13).
 */
function navLinkStyle({ isActive }) {
    return {
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: MIN_TOUCH_TARGET,
        padding: `0 ${SPACE.lg}px`,
        borderRadius: RADIUS.pill,
        textDecoration: 'none',
        fontWeight: isActive ? 600 : 400,
        color: isActive ? cssVar('bone') : cssVar('ink'),
        background: isActive ? cssVar('ink') : 'transparent',
    };
}
const mainStyle = {
    flex: 1,
    width: '100%',
    maxWidth: 1440,
    minWidth: 0,
    margin: '0 auto',
    boxSizing: 'border-box',
};
/**
 * The Retrofit lockup, the same one the phone app opens with: a flat accent
 * disc carrying a house glyph, then the wordmark in the display face. One
 * colour, no gradient. The mark is decoration — the wordmark beside it is the
 * real text — so it is hidden from screen readers.
 */
function Brand() {
    return (_jsxs("p", { className: "rf-brand", children: [_jsx("span", { className: "rf-brand__mark", "aria-hidden": "true", children: _jsxs("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", focusable: "false", children: [_jsx("path", { d: "M3.5 11.2 12 4l8.5 7.2", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }), _jsx("path", { d: "M5.8 10.2V19a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1v-8.8", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" })] }) }), _jsx("span", { className: "rf-brand__word", children: "Retrofit" })] }));
}
/**
 * Console shell: skip link, header (brand, primary nav, adapter banner), main.
 * The banner is rendered unconditionally in the header on every route —
 * PRD §10 "Never hidden".
 */
export function Layout(props) {
    const { nav, banner, children } = props;
    return (_jsxs("div", { style: shellStyle, children: [_jsx("a", { href: `#${MAIN_ID}`, style: skipLinkStyle, onFocus: (event) => {
                    event.currentTarget.style.top = `${SPACE.sm}px`;
                }, onBlur: (event) => {
                    event.currentTarget.style.top = '-100px';
                }, children: "Skip to content" }), _jsxs("header", { style: headerStyle, children: [_jsx(Brand, {}), _jsx("nav", { "aria-label": "Primary", style: { flex: '1 1 auto' }, children: _jsx("ul", { style: navListStyle, children: nav.map((item) => (_jsx("li", { children: _jsx(NavLink, { to: item.to, className: "rf-nav-link", style: navLinkStyle, children: item.label }) }, item.to))) }) }), _jsx("div", { "data-testid": "adapter-banner-slot", children: banner })] }), _jsx("main", { id: MAIN_ID, className: "rf-main", tabIndex: -1, style: mainStyle, children: children })] }));
}
//# sourceMappingURL=Layout.js.map