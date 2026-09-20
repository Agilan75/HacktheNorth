import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router';
import { MIN_TOUCH_TARGET, SPACE, cssVar } from '@retrofit/design';
/** Accent + value colour per tone. Red stays reserved for verdicts. */
const TONES = {
    neutral: { accent: cssVar('mutedTint'), value: cssVar('ink'), surface: 'transparent' },
    positive: { accent: cssVar('green'), value: cssVar('greenDeep'), surface: 'transparent' },
    attention: { accent: cssVar('mutedDeep'), value: cssVar('ink'), surface: cssVar('mutedTint') },
    info: { accent: cssVar('blue'), value: cssVar('blueDeep'), surface: 'transparent' },
};
const BOX = {
    position: 'relative',
    border: `1px solid ${cssVar('mutedTint')}`,
    borderRadius: cssVar('radius-card'),
    padding: SPACE.lg,
    margin: 0,
    minHeight: MIN_TOUCH_TARGET,
};
const LABEL = {
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    color: cssVar('mutedDeep'),
    margin: 0,
};
const VALUE = {
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-title'),
    lineHeight: cssVar('leading-title'),
    display: 'block',
    margin: 0,
};
/** Covers the tile so the whole surface is clickable, label included. */
const STRETCH = {
    position: 'absolute',
    inset: 0,
    borderRadius: cssVar('radius-card'),
    minHeight: MIN_TOUCH_TARGET,
};
export function Tile(props) {
    const { label, value, detail, tone = 'neutral', href, testId } = props;
    const [focused, setFocused] = useState(false);
    const palette = TONES[tone];
    const box = {
        ...BOX,
        background: palette.surface,
        borderLeft: `3px solid ${palette.accent}`,
        ...(focused ? { outline: `2px solid ${cssVar('blue')}`, outlineOffset: 2 } : {}),
    };
    return (_jsxs("div", { style: box, "data-testid": testId, "data-tone": tone, children: [_jsx("dt", { style: LABEL, children: label }), _jsxs("dd", { style: { margin: 0 }, children: [_jsx("span", { style: { ...VALUE, color: palette.value }, children: value }), detail !== undefined && detail !== null ? (_jsx("span", { style: { ...LABEL, display: 'block' }, children: detail })) : null] }), href !== undefined ? (_jsx(Link, { to: href, "aria-label": label, style: STRETCH, onFocus: () => setFocused(true), onBlur: () => setFocused(false) })) : null] }));
}
//# sourceMappingURL=Tile.js.map