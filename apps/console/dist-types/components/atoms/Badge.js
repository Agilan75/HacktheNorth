import { jsx as _jsx } from "react/jsx-runtime";
/**
 * A small labelled badge, e.g. '1 flip from FIT'. Tone is decoration; the label carries the meaning.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function Badge(props) {
    const tone = props.tone ?? 'neutral';
    return (_jsx("span", { className: `rf-badge rf-badge--${tone}`, "data-tone": tone, title: props.title, children: props.label }));
}
//# sourceMappingURL=Badge.js.map