import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink } from 'react-router';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';
const MAIN_ID = 'rf-main';
const shellStyle = {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: cssVar('paper'),
    color: cssVar('ink'),
    fontFamily: cssVar('font-body'),
};
const skipLinkStyle = {
    position: 'absolute',
    left: SPACE.lg,
    top: -100,
    padding: SPACE.sm,
    background: cssVar('ink'),
    color: cssVar('paper'),
    borderRadius: RADIUS.card,
    zIndex: 10,
};
const headerStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACE.lg,
    padding: `${SPACE.md}px ${SPACE.xl}px`,
    borderBottom: `1px solid ${cssVar('muted-tint')}`,
    background: cssVar('paper'),
};
const brandStyle = {
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-heading'),
    lineHeight: cssVar('leading-heading'),
    margin: 0,
};
const navListStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: SPACE.xs,
    listStyle: 'none',
    margin: 0,
    padding: 0,
};
function navLinkStyle({ isActive }) {
    return {
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: MIN_TOUCH_TARGET,
        padding: `0 ${SPACE.md}px`,
        borderRadius: RADIUS.pill,
        textDecoration: isActive ? 'underline' : 'none',
        textUnderlineOffset: 4,
        fontWeight: isActive ? 600 : 400,
        color: cssVar('ink'),
        background: isActive ? cssVar('muted-tint') : 'transparent',
    };
}
const mainStyle = {
    flex: 1,
    width: '100%',
    maxWidth: 1440,
    margin: '0 auto',
    padding: `${SPACE.xl}px`,
    boxSizing: 'border-box',
};
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
                }, children: "Skip to content" }), _jsxs("header", { style: headerStyle, children: [_jsx("p", { style: brandStyle, children: "Retrofit" }), _jsx("nav", { "aria-label": "Primary", style: { flex: '1 1 auto' }, children: _jsx("ul", { style: navListStyle, children: nav.map((item) => (_jsx("li", { children: _jsx(NavLink, { to: item.to, style: navLinkStyle, children: item.label }) }, item.to))) }) }), _jsx("div", { "data-testid": "adapter-banner-slot", children: banner })] }), _jsx("main", { id: MAIN_ID, tabIndex: -1, style: mainStyle, children: children })] }));
}
//# sourceMappingURL=Layout.js.map