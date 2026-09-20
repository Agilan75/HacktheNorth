import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Stable, DOM-safe id for the heading so the section is labelled by it. */
function headingId(title, anchorId) {
    const base = (anchorId ?? title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `rf-card-${base || 'untitled'}-title`;
}
/**
 * Radius 16, 1px Muted-tint border, no shadow (PRD 13).
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function Card(props) {
    const { title, aside, children, anchorId } = props;
    const labelId = headingId(title, anchorId);
    return (_jsxs("section", { className: "rf-card", id: anchorId, "aria-labelledby": labelId, children: [_jsxs("header", { className: "rf-card__header", children: [_jsx("h2", { className: "rf-card__title", id: labelId, children: title }), aside !== undefined && aside !== null ? (_jsx("div", { className: "rf-card__aside", children: aside })) : null] }), _jsx("div", { className: "rf-card__body", children: children })] }));
}
//# sourceMappingURL=Card.js.map