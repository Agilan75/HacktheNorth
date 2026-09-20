import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useState } from 'react';
import { formatPercent, formatScore, formatVerdict } from '@retrofit/contracts';
import { Badge } from '../components/atoms/Badge.js';
/** Mirrors `MIN_EXTRACTION_CONFIDENCE` (PRD 7.6: accepted at ≥ 0.8). Label text only; `accepted` decides. */
const MIN_EXTRACTION_CONFIDENCE = 0.8;
const ACCEPT_FILES = '.pdf,.txt,.eml,.md,application/pdf,text/plain';
function fieldStatus(field) {
    if (field.accepted)
        return 'Accepted';
    if (field.rejectedReason !== null && field.rejectedReason.trim() !== '')
        return field.rejectedReason;
    return `Needs confirmation (under ${formatPercent(MIN_EXTRACTION_CONFIDENCE)})`;
}
function FieldsTable(props) {
    if (props.fields.length === 0) {
        return _jsx("p", { className: "rf-empty", children: "No field values were found in the reply." });
    }
    return (_jsx("div", { className: "rf-scroll-x", children: _jsxs("table", { className: "rf-table", "aria-label": "Extracted fields", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Field" }), _jsx("th", { scope: "col", children: "Value" }), _jsx("th", { scope: "col", children: "Confidence" }), _jsx("th", { scope: "col", children: "Status" }), _jsx("th", { scope: "col", children: "Quoted from the reply" })] }) }), _jsx("tbody", { children: props.fields.map((f) => (_jsxs("tr", { "data-testid": "reply-field", "data-accepted": f.accepted ? 'true' : 'false', children: [_jsxs("th", { scope: "row", children: [f.label, _jsx("br", {}), _jsx("code", { children: f.path })] }), _jsx("td", { children: f.value }), _jsx("td", { children: formatPercent(f.confidence) }), _jsx("td", { children: _jsx(Badge, { label: fieldStatus(f), tone: f.accepted ? 'quiet' : 'attention' }) }), _jsx("td", { children: _jsx("blockquote", { className: "rf-citation__quote", children: `“${f.quote}”` }) })] }, f.path))) })] }) }));
}
function snapshot(entry) {
    if (entry === null)
        return '—';
    const score = formatScore(entry.afterScore ?? entry.beforeScore);
    const rank = formatScore(entry.afterRank ?? entry.beforeRank);
    const verdict = formatVerdict(entry.afterVerdict ?? entry.beforeVerdict);
    return `score ${score}, rank ${rank}, ${verdict}`;
}
function Movement(props) {
    const { before, after } = props.result;
    if (before === null && after === null)
        return null;
    return (_jsxs("dl", { className: "rf-stats", "data-testid": "reply-movement", children: [_jsxs("div", { className: "rf-stat", "data-testid": "reply-before", children: [_jsx("dt", { children: "Before the reply" }), _jsx("dd", { children: snapshot(before) })] }), _jsxs("div", { className: "rf-stat", "data-testid": "reply-after", children: [_jsx("dt", { children: "After the reply" }), _jsx("dd", { children: snapshot(after) })] })] }));
}
/**
 * PRD 10 (k) Paste or upload the broker reply; shows extracted fields with quotes.
 *
 * Gemini extracts and code validates on the server; this box only sends text
 * or a file and renders the typed result it gets back.
 */
export function ReplyBox(props) {
    const { submissionId, result, pending, onSubmitText, onSubmitFile } = props;
    const [text, setText] = useState('');
    const [error, setError] = useState(null);
    const textId = useId();
    const fileId = useId();
    const trimmed = text.trim();
    const run = async (fn, onOk) => {
        setError(null);
        try {
            await fn();
            onOk?.();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };
    const submit = (event) => {
        event.preventDefault();
        if (trimmed === '' || pending)
            return;
        void run(() => onSubmitText(trimmed), () => setText(''));
    };
    const pick = (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (file === undefined || pending)
            return;
        void run(() => onSubmitFile(file), () => {
            input.value = '';
        });
    };
    return (_jsxs("div", { className: "rf-reply", "data-testid": "reply-box", "data-submission-id": submissionId, children: [_jsx("h3", { className: "rf-card__subtitle", children: "Broker reply" }), _jsxs("form", { onSubmit: submit, "aria-busy": pending, style: { display: 'flex', flexDirection: 'column', gap: 'var(--rf-space-md)', maxWidth: 640 }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--rf-space-xs)' }, children: [_jsx("label", { htmlFor: textId, children: "Paste the broker's reply" }), _jsx("textarea", { id: textId, rows: 6, value: text, onChange: (e) => setText(e.currentTarget.value), disabled: pending, placeholder: "e.g. Building B-1 was built in 1991 per the county assessor.", style: { width: '100%' } })] }), _jsx("button", { type: "submit", className: "rf-button rf-button--primary", disabled: pending || trimmed === '', style: { alignSelf: 'flex-start' }, children: pending ? 'Extracting…' : 'Extract fields' }), _jsxs("div", { style: {
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 'var(--rf-space-sm)',
                            paddingTop: 'var(--rf-space-sm)',
                            borderTop: '1px solid var(--rf-muted-tint)',
                        }, children: [_jsx("label", { htmlFor: fileId, children: "Or upload a reply (PDF or text, e.g. loss runs)" }), _jsx("input", { id: fileId, type: "file", accept: ACCEPT_FILES, onChange: pick, disabled: pending })] })] }), _jsx("p", { "aria-live": "polite", className: "rf-footnote", children: pending ? 'Reading the reply…' : '' }), error !== null ? (_jsx("p", { role: "alert", className: "rf-error", children: `Reply failed: ${error}` })) : null, result !== null ? (_jsxs("div", { className: "rf-reply__result", "data-testid": "reply-result", children: [_jsx(FieldsTable, { fields: result.fields }), _jsx(Movement, { result: result })] })) : null] }));
}
//# sourceMappingURL=ReplyBox.js.map