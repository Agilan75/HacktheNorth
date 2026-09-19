import type { ReactElement, ReactNode } from 'react';

export interface DataTableColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly align?: 'left' | 'right';
  readonly render: (row: Row) => ReactNode;
  /** Optional sort key; when absent the column is not sortable. */
  readonly sortValue?: (row: Row) => string | number | null;
  readonly headerTitle?: string;
}

export interface DataTableProps<Row> {
  /** Required: read by screen readers as the table's <caption>. */
  readonly caption: string;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly emptyLabel: string;
  readonly loading?: boolean;
  readonly onRowClick?: (row: Row) => void;
}

/** Stub frozen by W0-4. Unit C03 replaces this body only. */
export function DataTable<Row>(_props: DataTableProps<Row>): ReactElement {
  throw new Error('NOT_IMPLEMENTED:C03');
}
