import { useId, useMemo, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { pluralize } from '@retrofit/contracts';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';

import type { GlossaryResponse } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Skeleton } from '../components/atoms/Skeleton.js';

type GlossaryEntry = GlossaryResponse['entries'][number];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_\-\s]+/g, ' ')
    .trim();
}

/** Stable anchor so other pages can link `/glossary#glossary-in-appetite`. */
function anchorFor(term: string): string {
  const slug = term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `glossary-${slug || 'term'}`;
}

/**
 * Every whitespace-separated query word must appear in the term, definition
 * or source. Term matches rank above definition-only matches; ties stay
 * alphabetical.
 */
function filterEntries(entries: readonly GlossaryEntry[], query: string): readonly GlossaryEntry[] {
  const sorted = [...entries].sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));
  const words = normalize(query).split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return sorted;
  const scored: { entry: GlossaryEntry; rank: number; order: number }[] = [];
  sorted.forEach((entry, order) => {
    const term = normalize(entry.term);
    const haystack = `${term} ${normalize(entry.definition)} ${normalize(entry.source)}`;
    if (!words.every((w) => haystack.includes(w))) return;
    const rank = term === words.join(' ') ? 0 : words.every((w) => term.includes(w)) ? 1 : 2;
    scored.push({ entry, rank, order });
  });
  scored.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return scored.map((s) => s.entry);
}

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.xl,
  fontFamily: cssVar('font-body'),
  color: cssVar('ink'),
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-title'),
  lineHeight: cssVar('leading-title'),
};

const leadStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
};

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.xs,
  maxWidth: 480,
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  color: cssVar('muted-deep'),
};

const inputStyle: CSSProperties = {
  minHeight: MIN_TOUCH_TARGET,
  padding: `0 ${SPACE.md}px`,
  border: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
  borderRadius: RADIUS.card,
  background: cssVar('paper'),
  color: cssVar('ink'),
  fontFamily: cssVar('font-body'),
  fontSize: cssVar('size-body'),
};

const listStyle: CSSProperties = {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.lg,
};

const itemStyle: CSSProperties = {
  padding: SPACE.lg,
  border: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
  borderRadius: RADIUS.card,
  scrollMarginTop: SPACE.xl,
};

const termStyle: CSSProperties = {
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-heading'),
  lineHeight: cssVar('leading-heading'),
  fontWeight: 600,
};

const definitionStyle: CSSProperties = {
  margin: `${SPACE.sm}px 0 0`,
  fontSize: cssVar('size-body'),
  lineHeight: cssVar('leading-body'),
};

const sourceStyle: CSSProperties = {
  display: 'block',
  marginTop: SPACE.sm,
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
};

/**
 * PRD 10 /glossary - searchable; also powers the tooltips.
 *
 * Stub frozen by W0-4. Unit C13 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function GlossaryPage(): ReactElement {
  const state = useApi((client) => client.getGlossary(), []);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const statusId = useId();

  const entries = state.data?.entries ?? [];
  const visible = useMemo(() => filterEntries(entries, query), [entries, query]);
  const trimmed = query.trim();

  let body: ReactElement;
  if (state.data === null && state.loading) {
    body = <Skeleton label="Loading the glossary" lines={6} />;
  } else if (state.data === null && state.error !== null) {
    body = (
      <div role="alert">
        <p style={{ margin: 0 }}>The glossary could not be loaded: {state.error.message}</p>
        <button type="button" onClick={state.reload} style={{ minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.sm }}>
          Try again
        </button>
      </div>
    );
  } else if (entries.length === 0) {
    body = <p>The glossary is empty.</p>;
  } else if (visible.length === 0) {
    body = <p>No glossary term matches “{trimmed}”.</p>;
  } else {
    body = (
      <dl style={listStyle} aria-label="Glossary terms">
        {visible.map((entry) => (
          <div key={entry.term} id={anchorFor(entry.term)} style={itemStyle}>
            <dt style={termStyle}>{entry.term}</dt>
            <dd style={definitionStyle}>
              {entry.definition}
              <cite style={sourceStyle}>{entry.source}</cite>
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  const status =
    state.data === null
      ? ''
      : trimmed.length === 0
        ? pluralize(entries.length, 'term')
        : `${pluralize(visible.length, 'term')} of ${entries.length} match “${trimmed}”`;

  return (
    <div style={pageStyle}>
      <header>
        <h1 style={titleStyle}>Glossary</h1>
        <p style={leadStyle}>
          Terms from Federato’s glossary. The same definitions appear as tooltips across the console.
        </p>
      </header>
      <div role="search" aria-label="Search the glossary">
        <label htmlFor={searchId} style={labelStyle}>
          Search terms and definitions
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby={statusId}
          autoComplete="off"
          style={{ ...inputStyle, marginTop: SPACE.xs, width: '100%', maxWidth: 480, boxSizing: 'border-box' }}
        />
        <p id={statusId} role="status" aria-live="polite" style={leadStyle}>
          {status}
        </p>
      </div>
      {body}
    </div>
  );
}
