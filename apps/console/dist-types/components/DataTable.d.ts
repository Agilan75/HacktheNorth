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
/**
 * Accessible data table shared by every console list (PRD §10, §13).
 *
 * - `caption` is always rendered as the table's <caption>.
 * - Sortable headers are real buttons with `aria-sort` on the <th>.
 * - Row activation works by click, Enter and Space when `onRowClick` is set.
 * - `loading` renders skeleton rows and marks the table `aria-busy`.
 */
export declare function DataTable<Row>(props: DataTableProps<Row>): ReactElement;
//# sourceMappingURL=DataTable.d.ts.map