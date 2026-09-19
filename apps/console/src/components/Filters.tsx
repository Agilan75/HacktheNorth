import { useId } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { formatVerdict } from '@retrofit/contracts';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';

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

const VERDICTS: readonly Verdict[] = ['FIT', 'REFER', 'DOES_NOT_FIT'];

/** Sentinel option value for "no filter". Never a real line, state or name. */
const ALL = '__all__';

const EMPTY: QueueFilterValue = {
  line: null,
  verdict: null,
  state: null,
  underwriter: null,
  search: '',
};

const formStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: SPACE.md,
  padding: `${SPACE.md}px 0`,
  fontFamily: cssVar('font-body'),
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.xs,
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  color: cssVar('muted-deep'),
};

const controlStyle: CSSProperties = {
  minHeight: MIN_TOUCH_TARGET,
  padding: `0 ${SPACE.md}px`,
  border: `1px solid ${cssVar('muted-tint')}`,
  borderRadius: RADIUS.card,
  background: cssVar('paper'),
  color: cssVar('ink'),
  font: 'inherit',
  fontSize: cssVar('size-small'),
};

const resetStyle: CSSProperties = {
  ...controlStyle,
  cursor: 'pointer',
  borderRadius: RADIUS.pill,
};

function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

interface SelectFieldProps {
  readonly label: string;
  readonly allLabel: string;
  readonly value: string | null;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onSelect: (next: string | null) => void;
}

function SelectField({ label, allLabel, value, options, onSelect }: SelectFieldProps): ReactElement {
  const id = useId();
  // A selected value no longer in the option list is still shown, so the
  // control never silently misrepresents the active filter.
  const shown =
    value !== null && !options.some((o) => o.value === value) ? [...options, { value, label: value }] : options;
  return (
    <div style={fieldStyle}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        style={controlStyle}
        value={value ?? ALL}
        onChange={(event) => onSelect(event.target.value === ALL ? null : event.target.value)}
      >
        <option value={ALL}>{allLabel}</option>
        {shown.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** PRD §10 /queue filters: line, verdict, state, underwriter, plus free-text search. */
export function Filters(props: FiltersProps): ReactElement {
  const { value, options, onChange } = props;
  const searchId = useId();

  const active =
    value.line !== null ||
    value.verdict !== null ||
    value.state !== null ||
    value.underwriter !== null ||
    value.search.trim() !== '';

  const toOptions = (values: readonly string[]) => uniqueSorted(values).map((v) => ({ value: v, label: v }));

  return (
    <form
      role="search"
      aria-label="Filter the queue"
      style={formStyle}
      onSubmit={(event) => event.preventDefault()}
    >
      <div style={{ ...fieldStyle, flex: '1 1 220px' }}>
        <label htmlFor={searchId}>Search</label>
        <input
          id={searchId}
          type="search"
          style={controlStyle}
          placeholder="Insured, ID or explanation"
          value={value.search}
          onChange={(event) => onChange({ ...value, search: event.target.value })}
        />
      </div>
      <SelectField
        label="Line of business"
        allLabel="All lines"
        value={value.line}
        options={toOptions(options.lines)}
        onSelect={(line) => onChange({ ...value, line })}
      />
      <SelectField
        label="Verdict"
        allLabel="All verdicts"
        value={value.verdict}
        options={VERDICTS.map((v) => ({ value: v, label: formatVerdict(v) }))}
        onSelect={(next) => onChange({ ...value, verdict: next !== null && isVerdict(next) ? next : null })}
      />
      <SelectField
        label="State"
        allLabel="All states"
        value={value.state}
        options={toOptions(options.states)}
        onSelect={(state) => onChange({ ...value, state })}
      />
      <SelectField
        label="Underwriter"
        allLabel="All underwriters"
        value={value.underwriter}
        options={toOptions(options.underwriters)}
        onSelect={(underwriter) => onChange({ ...value, underwriter })}
      />
      <button type="button" style={resetStyle} disabled={!active} onClick={() => onChange(EMPTY)}>
        Clear filters
      </button>
    </form>
  );
}
