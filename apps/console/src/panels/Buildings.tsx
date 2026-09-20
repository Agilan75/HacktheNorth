import type { ReactElement } from 'react';

import { formatMoney, formatPercent, formatTiv, pluralize, titleCase } from '@retrofit/contracts';
import { cssVar, SPACE } from '@retrofit/design';

import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import { DataTable } from '../components/DataTable.js';
import type { DataTableColumn } from '../components/DataTable.js';
import type { BuildingRowView, BuildingsPanelProps, RollupView } from './types.js';

/** A building field Federato left blank: say so in words, never a bare dash. */
const NOT_REPORTED = 'Not reported';

/** Every figure here is read straight off the rollup the engine returned; nothing is recomputed. */
function rollupItems(rollup: RollupView): readonly { readonly term: string; readonly value: string }[] {
  return [
    { term: 'Total TIV', value: formatTiv(rollup.totalTiv) },
    { term: 'Buildings', value: rollup.buildingCount.toLocaleString('en-US') },
    { term: 'TIV pre-1990', value: formatPercent(rollup.pctTivPre1990, { decimals: 1 }) },
    { term: 'TIV 2010 or newer', value: formatPercent(rollup.pctTivPost2010, { decimals: 1 }) },
    {
      term: 'TIV in acceptable construction',
      value: formatPercent(rollup.pctTivAcceptableConstruction, { decimals: 1 }),
    },
    { term: 'Primary state', value: rollup.primaryState ?? NOT_REPORTED },
    { term: 'Five-year loss', value: formatMoney(rollup.fiveYearLoss) },
  ];
}

function sprinklerText(value: boolean | null): string {
  if (value === null) return NOT_REPORTED;
  return value ? 'Yes' : 'No';
}

const COLUMNS: readonly DataTableColumn<BuildingRowView>[] = [
  { key: 'id', header: 'Building', render: (b) => b.id, sortValue: (b) => b.id },
  { key: 'address', header: 'Address', render: (b) => b.address ?? NOT_REPORTED, sortValue: (b) => b.address },
  { key: 'state', header: 'State', render: (b) => b.state ?? NOT_REPORTED, sortValue: (b) => b.state },
  {
    key: 'yearBuilt',
    header: 'Year built',
    align: 'right',
    render: (b) => (b.yearBuilt === null ? NOT_REPORTED : String(b.yearBuilt)),
    sortValue: (b) => b.yearBuilt,
  },
  {
    key: 'construction',
    header: 'Construction',
    render: (b) => (b.constructionType === null ? NOT_REPORTED : titleCase(b.constructionType)),
    sortValue: (b) => b.constructionType,
  },
  { key: 'tiv', header: 'TIV', align: 'right', render: (b) => formatTiv(b.tiv), sortValue: (b) => b.tiv },
  {
    key: 'sprinklered',
    header: 'Sprinklered',
    render: (b) => sprinklerText(b.sprinklered),
    sortValue: (b) => (b.sprinklered === null ? null : b.sprinklered ? 1 : 0),
  },
  {
    key: 'protectionClass',
    header: 'Protection class',
    headerTitle: 'Public protection class (1 best, 10 worst)',
    align: 'right',
    render: (b) => (b.protectionClass === null ? NOT_REPORTED : String(b.protectionClass)),
    sortValue: (b) => b.protectionClass,
  },
  {
    key: 'flags',
    header: 'Flags',
    render: (b) =>
      b.flags.length === 0 ? (
        'None'
      ) : (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: SPACE.xs }}>
          {b.flags.map((flag) => (
            <Badge key={flag} label={flag} tone="attention" />
          ))}
        </span>
      ),
    sortValue: (b) => b.flags.length,
  },
];

/**
 * PRD 10 (e) Buildings table with the rollup.
 *
 * Stub frozen by W0-4. Unit C09 replaces this body only — never the signature,
 * never the import list's shape, never this file's path.
 */
export function Buildings(props: BuildingsPanelProps): ReactElement {
  const { buildings, rollup } = props;
  const items = rollupItems(rollup);
  const partial = buildings.length !== rollup.buildingCount;
  return (
    <Card
      title="Buildings"
      anchorId="e"
      aside={<Badge label={pluralize(rollup.buildingCount, 'building')} tone="quiet" />}
    >
      <dl
        aria-label="Rollup"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: SPACE.md,
          margin: `0 0 ${SPACE.lg}px`,
        }}
      >
        {items.map((item) => (
          <div key={item.term} data-testid={`rollup-${item.term}`}>
            <dt style={{ color: cssVar('muted-deep'), fontSize: cssVar('size-micro') }}>{item.term}</dt>
            <dd style={{ margin: 0, fontSize: cssVar('size-body'), fontWeight: 600 }}>{item.value}</dd>
          </div>
        ))}
      </dl>
      {partial ? (
        <p style={{ color: cssVar('muted-deep'), fontSize: cssVar('size-small'), margin: `0 0 ${SPACE.sm}px` }}>
          Showing {pluralize(buildings.length, 'building')} of {rollup.buildingCount.toLocaleString('en-US')} in
          the rollup.
        </p>
      ) : null}
      <DataTable
        caption="Schedule of buildings"
        columns={COLUMNS}
        rows={buildings}
        rowKey={(b) => b.id}
        emptyLabel="No buildings on this submission."
      />
    </Card>
  );
}
