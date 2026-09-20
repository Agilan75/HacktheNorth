import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
import { formatVerdict } from '@retrofit/contracts';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';
const VERDICTS = ['FIT', 'REFER', 'DOES_NOT_FIT'];
/** Sentinel option value for "no filter". Never a real line, state or name. */
const ALL = '__all__';
const EMPTY = {
    line: null,
    verdict: null,
    state: null,
    underwriter: null,
    search: '',
};
const formStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: SPACE.md,
    padding: `${SPACE.md}px 0`,
    borderBottom: `1px solid ${cssVar('muted-tint')}`,
    fontFamily: cssVar('font-body'),
};
const fieldStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.xs,
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    color: cssVar('muted-deep'),
};
const controlStyle = {
    minHeight: MIN_TOUCH_TARGET,
    padding: `0 ${SPACE.md}px`,
    border: `1px solid ${cssVar('muted-tint')}`,
    borderRadius: RADIUS.card,
    background: cssVar('paper'),
    color: cssVar('ink'),
    font: 'inherit',
    fontSize: cssVar('size-small'),
};
const resetStyle = {
    ...controlStyle,
    cursor: 'pointer',
    borderRadius: RADIUS.pill,
};
function isVerdict(value) {
    return VERDICTS.includes(value);
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}
function SelectField({ label, allLabel, value, options, onSelect }) {
    const id = useId();
    // A selected value no longer in the option list is still shown, so the
    // control never silently misrepresents the active filter.
    const shown = value !== null && !options.some((o) => o.value === value) ? [...options, { value, label: value }] : options;
    return (_jsxs("div", { style: fieldStyle, children: [_jsx("label", { htmlFor: id, children: label }), _jsxs("select", { id: id, style: controlStyle, value: value ?? ALL, onChange: (event) => onSelect(event.target.value === ALL ? null : event.target.value), children: [_jsx("option", { value: ALL, children: allLabel }), shown.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value)))] })] }));
}
/** Queue filters: line, verdict, state, underwriter, plus free-text search. */
export function Filters(props) {
    const { value, options, onChange } = props;
    const searchId = useId();
    const active = value.line !== null ||
        value.verdict !== null ||
        value.state !== null ||
        value.underwriter !== null ||
        value.search.trim() !== '';
    const toOptions = (values) => uniqueSorted(values).map((v) => ({ value: v, label: v }));
    return (_jsxs("form", { role: "search", "aria-label": "Filter the queue", style: formStyle, onSubmit: (event) => event.preventDefault(), children: [_jsxs("div", { style: { ...fieldStyle, flex: '1 1 220px' }, children: [_jsx("label", { htmlFor: searchId, children: "Search" }), _jsx("input", { id: searchId, type: "search", style: controlStyle, placeholder: "Insured, ID or explanation", value: value.search, onChange: (event) => onChange({ ...value, search: event.target.value }) })] }), _jsx(SelectField, { label: "Line of business", allLabel: "All lines", value: value.line, options: toOptions(options.lines), onSelect: (line) => onChange({ ...value, line }) }), _jsx(SelectField, { label: "Verdict", allLabel: "All verdicts", value: value.verdict, options: VERDICTS.map((v) => ({ value: v, label: formatVerdict(v) })), onSelect: (next) => onChange({ ...value, verdict: next !== null && isVerdict(next) ? next : null }) }), _jsx(SelectField, { label: "State", allLabel: "All states", value: value.state, options: toOptions(options.states), onSelect: (state) => onChange({ ...value, state }) }), _jsx(SelectField, { label: "Underwriter", allLabel: "All underwriters", value: value.underwriter, options: toOptions(options.underwriters), onSelect: (underwriter) => onChange({ ...value, underwriter }) }), _jsx("button", { type: "button", style: resetStyle, disabled: !active, onClick: () => onChange(EMPTY), children: "Clear filters" })] }));
}
//# sourceMappingURL=Filters.js.map