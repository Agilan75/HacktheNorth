import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { EM_DASH, formatScore, pluralize } from '@retrofit/contracts';
import { cssVar, SPACE } from '@retrofit/design';
import { Badge } from '../components/atoms/Badge';
import { Card } from '../components/atoms/Card';
import { DataTable } from '../components/DataTable';
const sectionStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.xl,
};
const codeStyle = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    wordBreak: 'break-all',
};
const emptyStyle = {
    margin: 0,
    fontSize: cssVar('size-small'),
    color: cssVar('muted-deep'),
};
function Code({ children }) {
    return _jsx("code", { style: codeStyle, children: children });
}
const unmappedColumns = [
    {
        key: 'sourcePath',
        header: 'Source key',
        render: (r) => _jsx(Code, { children: r.sourcePath }),
        sortValue: (r) => r.sourcePath,
    },
    {
        key: 'sampleValue',
        header: 'Sample value',
        render: (r) => (r.sampleValue === null || r.sampleValue === '' ? EM_DASH : _jsx(Code, { children: r.sampleValue })),
    },
    { key: 'reason', header: 'Why it stayed unmapped', render: (r) => r.reason },
];
const mappedColumns = [
    {
        key: 'sourcePath',
        header: 'Source key',
        render: (r) => _jsx(Code, { children: r.sourcePath }),
        sortValue: (r) => r.sourcePath,
    },
    {
        key: 'canonicalPath',
        header: 'Canonical field',
        render: (r) => _jsx(Code, { children: r.canonicalPath }),
        sortValue: (r) => r.canonicalPath,
    },
    { key: 'method', header: 'Method', render: (r) => r.method, sortValue: (r) => r.method },
    {
        key: 'score',
        header: 'Confidence',
        align: 'right',
        headerTitle: 'Match confidence; schema-assist matches are accepted at 0.80 or above',
        render: (r) => formatScore(r.score, { decimals: 2 }),
        sortValue: (r) => r.score,
    },
];
const resourceColumns = [
    { key: 'name', header: 'Resource', render: (r) => r.name, sortValue: (r) => r.name },
    {
        key: 'fieldCount',
        header: 'Fields',
        align: 'right',
        render: (r) => formatScore(r.fieldCount),
        sortValue: (r) => r.fieldCount,
    },
    {
        key: 'mappedCount',
        header: 'Mapped',
        align: 'right',
        render: (r) => `${formatScore(r.mappedCount)} of ${formatScore(r.fieldCount)}`,
        sortValue: (r) => r.mappedCount,
    },
];
/**
 * PRD 10 (i) Discovered schema with unmapped keys.
 *
 * Stub frozen by W0-4. Unit C07 replaces this body only — never the signature,
 * never the import list's shape, never this file's path.
 */
export function Schema(props) {
    const { schema } = props;
    if (schema === null) {
        return (_jsx(Card, { title: "Discovered schema", anchorId: "schema", children: _jsx("p", { style: emptyStyle, children: "No schema was captured for this submission." }) }));
    }
    const unmappedCount = schema.unmapped.length;
    const aside = (_jsx(Badge, { label: unmappedCount === 0 ? 'All keys mapped' : `${pluralize(unmappedCount, 'unmapped key')}`, tone: unmappedCount === 0 ? 'quiet' : 'attention' }));
    return (_jsx(Card, { title: "Discovered schema", anchorId: "schema", aside: aside, children: _jsxs("div", { style: sectionStyle, children: [_jsx(DataTable, { caption: `Unmapped keys (${unmappedCount})`, columns: unmappedColumns, rows: schema.unmapped, rowKey: (r) => r.sourcePath, emptyLabel: "Every discovered key was placed in the field map." }), _jsx(DataTable, { caption: `Mapped keys (${schema.mapped.length})`, columns: mappedColumns, rows: schema.mapped, rowKey: (r) => `${r.sourcePath}->${r.canonicalPath}`, emptyLabel: "No keys were mapped." }), _jsx(DataTable, { caption: `Resources (${schema.resources.length})`, columns: resourceColumns, rows: schema.resources, rowKey: (r) => r.name, emptyLabel: "The schema listed no resources." })] }) }));
}
//# sourceMappingURL=Schema.js.map