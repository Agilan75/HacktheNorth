import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { VERDICT_MARKS, VERDICT_STYLES } from '@retrofit/design';
const VARIANT_CLASS = {
    FIT: 'rf-pill--fit',
    REFER: 'rf-pill--refer',
    DOES_NOT_FIT: 'rf-pill--does-not-fit',
};
/**
 * PRD 13: FIT is a red filled pill, REFER red outlined, DOES_NOT_FIT ink filled. The verdict word is always rendered as text, because colour never carries meaning alone.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function VerdictPill(props) {
    const { verdict, detail } = props;
    const style = VERDICT_STYLES[verdict];
    const trimmed = detail?.trim();
    return (_jsxs("span", { className: `rf-pill ${VARIANT_CLASS[verdict]}`, "data-verdict": verdict, "data-variant": style.variant, title: trimmed ? `${style.label}: ${trimmed}` : style.label, children: [_jsx("span", { className: "rf-pill__mark", "aria-hidden": "true", children: VERDICT_MARKS[verdict] }), _jsx("span", { className: "rf-pill__word", children: style.short }), _jsx("span", { className: "rf-sr-only", children: ` (${style.label})` }), trimmed ? _jsx("span", { className: "rf-pill__detail", children: ` · ${trimmed}` }) : null] }));
}
//# sourceMappingURL=VerdictPill.js.map