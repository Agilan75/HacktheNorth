import type { CSSProperties, ReactElement } from 'react';

import { EM_DASH, formatScore, pluralize } from '@retrofit/contracts';
import { cssVar, SPACE } from '@retrofit/design';

import { Badge } from '../components/atoms/Badge';
import { Card } from '../components/atoms/Card';
import { DataTable } from '../components/DataTable';
import type { DataTableColumn } from '../components/DataTable';
import type { SchemaPanelProps, SchemaView } from './types.js';

type ResourceRow = SchemaView['resources'][number];
type MappedRow = SchemaView['mapped'][number];
type UnmappedRow = SchemaView['unmapped'][number];

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.xl,
};

const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  wordBreak: 'break-all',
};

const emptyStyle: CSSProperties = {
  margin: 0,
  fontSize: cssVar('size-small'),
  color: cssVar('muted-deep'),
};

function Code({ children }: { readonly children: string }): ReactElement {
  return <code style={codeStyle}>{children}</code>;
}

const unmappedColumns: readonly DataTableColumn<UnmappedRow>[] = [
  {
    key: 'sourcePath',
    header: 'Source key',
    render: (r) => <Code>{r.sourcePath}</Code>,
    sortValue: (r) => r.sourcePath,
  },
  {
    key: 'sampleValue',
    header: 'Sample value',
    render: (r) => (r.sampleValue === null || r.sampleValue === '' ? EM_DASH : <Code>{r.sampleValue}</Code>),
  },
  { key: 'reason', header: 'Why it stayed unmapped', render: (r) => r.reason },
];

const mappedColumns: readonly DataTableColumn<MappedRow>[] = [
  {
    key: 'sourcePath',
    header: 'Source key',
    render: (r) => <Code>{r.sourcePath}</Code>,
    sortValue: (r) => r.sourcePath,
  },
  {
    key: 'canonicalPath',
    header: 'Canonical field',
    render: (r) => <Code>{r.canonicalPath}</Code>,
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

const resourceColumns: readonly DataTableColumn<ResourceRow>[] = [
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
export function Schema(props: SchemaPanelProps): ReactElement {
  const { schema } = props;
  if (schema === null) {
    return (
      <Card title="Discovered schema" anchorId="schema">
        <p style={emptyStyle}>No schema was captured for this submission.</p>
      </Card>
    );
  }

  const unmappedCount = schema.unmapped.length;
  const aside = (
    <Badge
      label={unmappedCount === 0 ? 'All keys mapped' : `${pluralize(unmappedCount, 'unmapped key')}`}
      tone={unmappedCount === 0 ? 'quiet' : 'attention'}
    />
  );

  return (
    <Card title="Discovered schema" anchorId="schema" aside={aside}>
      <div style={sectionStyle}>
        <DataTable
          caption={`Unmapped keys (${unmappedCount})`}
          columns={unmappedColumns}
          rows={schema.unmapped}
          rowKey={(r) => r.sourcePath}
          emptyLabel="Every discovered key was placed in the field map."
        />
        <DataTable
          caption={`Mapped keys (${schema.mapped.length})`}
          columns={mappedColumns}
          rows={schema.mapped}
          rowKey={(r) => `${r.sourcePath}->${r.canonicalPath}`}
          emptyLabel="No keys were mapped."
        />
        <DataTable
          caption={`Resources (${schema.resources.length})`}
          columns={resourceColumns}
          rows={schema.resources}
          rowKey={(r) => r.name}
          emptyLabel="The schema listed no resources."
        />
      </div>
    </Card>
  );
}
