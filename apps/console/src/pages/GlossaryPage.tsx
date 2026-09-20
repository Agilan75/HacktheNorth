import { useId, useMemo } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { pluralize } from '@retrofit/contracts';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';

import { ROUTES } from '../routes.js';
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

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function letterOf(term: string): string {
  const first = term.trim().charAt(0).toUpperCase();
  return LETTERS.includes(first) ? first : '#';
}

function letterAnchor(letter: string): string {
  return `glossary-letter-${letter === '#' ? 'other' : letter.toLowerCase()}`;
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

interface LetterGroup {
  readonly letter: string;
  readonly entries: readonly GlossaryEntry[];
}

/** Groups in display order. A search reorders within a letter but never across. */
function groupByLetter(entries: readonly GlossaryEntry[]): readonly LetterGroup[] {
  const buckets = new Map<string, GlossaryEntry[]>();
  for (const entry of entries) {
    const letter = letterOf(entry.term);
    const bucket = buckets.get(letter);
    if (bucket === undefined) buckets.set(letter, [entry]);
    else bucket.push(entry);
  }
  const order = [...LETTERS, '#'];
  return order
    .filter((letter) => buckets.has(letter))
    .map((letter) => ({ letter, entries: buckets.get(letter) ?? [] }));
}

/* --------------------------------------------------------------- the way back */

/**
 * Only the console's own pages; anything else (or no referrer) shows nothing.
 * Read lazily: App.tsx imports this module before it defines `ROUTES`, so a
 * module-scope read would see `undefined`.
 */
function backLabels(): readonly { readonly path: string; readonly label: string }[] {
  return [
    { path: ROUTES.queue, label: 'the queue' },
    { path: ROUTES.actions, label: 'actions' },
    { path: ROUTES.rules, label: 'rules' },
    { path: ROUTES.aggregate, label: 'the aggregate' },
    { path: ROUTES.verification, label: 'verification' },
    { path: ROUTES.explore, label: 'explore' },
  ];
}

interface BackLink {
  readonly to: string;
  readonly label: string;
}

function labelForPath(pathname: string): BackLink | null {
  if (pathname.startsWith('/submissions/')) return { to: pathname, label: 'the submission' };
  const hit = backLabels().find((row) => row.path === pathname);
  return hit === undefined ? null : { to: hit.path, label: hit.label };
}

function readBackLink(state: unknown): BackLink | null {
  const bag = typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {};
  if (typeof bag.from === 'string' && bag.from.startsWith('/')) {
    const [pathname] = bag.from.split('?');
    const hit = labelForPath(pathname ?? '');
    if (hit !== null) return { to: bag.from, label: hit.label };
  }
  try {
    if (typeof document === 'undefined' || typeof window === 'undefined') return null;
    const ref = document.referrer;
    if (typeof ref !== 'string' || ref === '') return null;
    const url = new URL(ref, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const hit = labelForPath(url.pathname);
    return hit === null ? null : { to: `${url.pathname}${url.search}`, label: hit.label };
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- styles */

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.lg,
  fontFamily: cssVar('font-body'),
  color: cssVar('ink'),
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-title'),
  lineHeight: cssVar('leading-title'),
};

const mutedStyle: CSSProperties = {
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

const jumpBarStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  display: 'flex',
  flexWrap: 'wrap',
  gap: SPACE.xs,
  padding: `${SPACE.sm}px 0`,
  background: cssVar('paper'),
  borderBottom: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
};

const jumpBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 28,
  minHeight: 28,
  padding: `0 ${SPACE.xs}px`,
  borderRadius: RADIUS.pill,
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  fontVariantNumeric: 'tabular-nums',
};

const jumpActive: CSSProperties = { ...jumpBase, color: cssVar('ink'), textDecoration: 'none', fontWeight: 600 };
const jumpMuted: CSSProperties = { ...jumpBase, color: cssVar('muted'), opacity: 0.5 };

const groupHeadingStyle: CSSProperties = {
  margin: 0,
  fontFamily: cssVar('font-body'),
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  letterSpacing: '0.08em',
  color: cssVar('muted-deep'),
  fontWeight: 600,
  scrollMarginTop: SPACE.xxl,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: `${SPACE.md}px ${SPACE.xl}px`,
  margin: `${SPACE.sm}px 0 0`,
};

const itemStyle: CSSProperties = {
  borderTop: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
  paddingTop: SPACE.sm,
  scrollMarginTop: SPACE.xxl,
};

const termStyle: CSSProperties = {
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-body'),
  lineHeight: cssVar('leading-body'),
  fontWeight: 600,
};

const definitionStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
};

const sourceStyle: CSSProperties = {
  display: 'block',
  marginTop: SPACE.xs,
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  fontStyle: 'normal',
};

/**
 * PRD 10 /glossary - searchable; also powers the tooltips.
 *
 * Route registration lives in src/App.tsx and is frozen.
 */
export function GlossaryPage(): ReactElement {
  const state = useApi((client) => client.getGlossary(), []);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const searchId = useId();
  const statusId = useId();

  const query = params.get('q') ?? '';
  const back = useMemo(() => readBackLink(location.state), [location.state]);

  const entries = state.data?.entries ?? [];
  const visible = useMemo(() => filterEntries(entries, query), [entries, query]);
  const groups = useMemo(() => groupByLetter(visible), [visible]);
  const present = useMemo(() => new Set(groups.map((g) => g.letter)), [groups]);
  const trimmed = query.trim();

  const onQuery = (value: string): void => {
    const next = new URLSearchParams(params);
    if (value.trim() === '') next.delete('q');
    else next.set('q', value);
    setParams(next, { replace: true });
  };

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
  } else if (trimmed.length > 0) {
    // A search is ranked, not alphabetical: grouping it by letter would throw
    // the ranking away, so the results stay one flat list.
    body = (
      <dl style={gridStyle} aria-label="Glossary terms">
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
  } else {
    body = (
      <>
        <nav aria-label="Jump to a letter" style={jumpBarStyle}>
          {[...LETTERS, '#'].map((letter) =>
            present.has(letter) ? (
              <a key={letter} href={`#${letterAnchor(letter)}`} style={jumpActive}>
                {letter}
              </a>
            ) : (
              <span key={letter} aria-hidden="true" style={jumpMuted}>
                {letter}
              </span>
            ),
          )}
        </nav>
        {groups.map((group) => (
          <section key={group.letter} aria-labelledby={letterAnchor(group.letter)}>
            <h2 id={letterAnchor(group.letter)} style={groupHeadingStyle}>
              {group.letter}
            </h2>
            <dl style={gridStyle} aria-label={`Glossary terms starting with ${group.letter}`}>
              {group.entries.map((entry) => (
                <div key={entry.term} id={anchorFor(entry.term)} style={itemStyle}>
                  <dt style={termStyle}>{entry.term}</dt>
                  <dd style={definitionStyle}>
                    {entry.definition}
                    <cite style={sourceStyle}>{entry.source}</cite>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </>
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
        {back !== null ? (
          <p style={{ margin: `0 0 ${SPACE.xs}px`, fontSize: cssVar('size-small') }}>
            <Link to={back.to}>{`← Back to ${back.label}`}</Link>
          </p>
        ) : null}
        <h1 style={titleStyle}>Glossary</h1>
      </header>
      <div role="search" aria-label="Search the glossary">
        <label htmlFor={searchId} style={labelStyle}>
          Search terms and definitions
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          aria-describedby={statusId}
          autoComplete="off"
          style={{ ...inputStyle, marginTop: SPACE.xs, width: '100%', maxWidth: 480, boxSizing: 'border-box' }}
        />
        <p id={statusId} role="status" aria-live="polite" style={mutedStyle}>
          {status}
        </p>
      </div>
      {body}
      <p style={{ ...mutedStyle, marginTop: SPACE.lg }}>
        Source: Federato’s glossary. The same definitions appear as console tooltips.
      </p>
    </div>
  );
}
