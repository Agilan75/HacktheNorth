import type { ReactElement } from 'react';
import type { Verdict } from '../panels/types.js';
export interface QueueFilterValue {
    readonly line: string | null;
    readonly verdict: Verdict | null;
    readonly state: string | null;
    readonly underwriter: string | null;
    readonly search: string;
}
export interface FilterOptions {
    readonly lines: readonly string[];
    readonly states: readonly string[];
    readonly underwriters: readonly string[];
}
export interface FiltersProps {
    readonly value: QueueFilterValue;
    readonly options: FilterOptions;
    readonly onChange: (next: QueueFilterValue) => void;
}
/** PRD §10 /queue filters. Stub frozen by W0-4; unit C03 replaces this body only. */
export declare function Filters(_props: FiltersProps): ReactElement;
//# sourceMappingURL=Filters.d.ts.map