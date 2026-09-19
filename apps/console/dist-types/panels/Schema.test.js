import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Schema } from './Schema';
const schema = {
    resources: [
        { name: 'Policy', fieldCount: 24, mappedCount: 9 },
        { name: 'Building', fieldCount: 18, mappedCount: 7 },
    ],
    mapped: [
        { sourcePath: 'Building.year_built', canonicalPath: 'buildings[].yearBuilt', method: 'synonym', score: 1 },
        { sourcePath: 'Building.sprinkler_pct', canonicalPath: 'buildings[].sprinklered', method: 'schema-assist', score: 0.8 },
    ],
    unmapped: [
        { sourcePath: 'Policy.custom_flag_7', sampleValue: 'Y', reason: 'schema-assist confidence 0.55 below 0.80' },
        { sourcePath: 'Building.roof_note', sampleValue: null, reason: 'No synonym and no sample values' },
    ],
};
afterEach(cleanup);
describe('Schema', () => {
    it('renders a null schema as an explicit empty state', () => {
        render(_jsx(Schema, { schema: null }));
        expect(screen.getByRole('heading', { name: 'Discovered schema' })).toBeInTheDocument();
        expect(screen.getByText('No schema was captured for this submission.')).toBeInTheDocument();
    });
    it('lists unmapped keys first with sample and reason, and badges the count', () => {
        render(_jsx(Schema, { schema: schema }));
        expect(screen.getByText('2 unmapped keys')).toBeInTheDocument();
        const tables = screen.getAllByRole('table');
        expect(tables).toHaveLength(3);
        const unmapped = screen.getByRole('table', { name: 'Unmapped keys (2)' });
        expect(tables[0]).toBe(unmapped);
        const rows = within(unmapped).getAllByRole('row').slice(1);
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText('Policy.custom_flag_7')).toBeInTheDocument();
        expect(within(rows[0]).getByText('Y')).toBeInTheDocument();
        expect(within(rows[1]).getAllByRole('cell')[1]).toHaveTextContent('—');
        expect(within(rows[1]).getByText('No synonym and no sample values')).toBeInTheDocument();
    });
    it('shows mapped confidence at two decimals and resource coverage', () => {
        render(_jsx(Schema, { schema: schema }));
        const mapped = screen.getByRole('table', { name: 'Mapped keys (2)' });
        expect(within(mapped).getByText('1.00')).toBeInTheDocument();
        expect(within(mapped).getByText('0.80')).toBeInTheDocument();
        expect(within(mapped).getByText('schema-assist')).toBeInTheDocument();
        const resources = screen.getByRole('table', { name: 'Resources (2)' });
        expect(within(resources).getByText('9 of 24')).toBeInTheDocument();
        expect(within(resources).getByText('7 of 18')).toBeInTheDocument();
    });
    it('says so when every key mapped', () => {
        render(_jsx(Schema, { schema: { ...schema, unmapped: [] } }));
        expect(screen.getByText('All keys mapped')).toBeInTheDocument();
        expect(screen.getByText('Every discovered key was placed in the field map.')).toBeInTheDocument();
    });
});
//# sourceMappingURL=Schema.test.js.map