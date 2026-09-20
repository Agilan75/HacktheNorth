import { useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';

import { MIN_TOUCH_TARGET, SPACE, cssVar } from '@retrofit/design';

/**
 * One headline figure: a big number over a small label, optionally linking
 * somewhere. Extracted from the near-duplicate local `Tile` that
 * AggregatePage and VerificationPage each carried.
 *
 * Always rendered inside a `<dl>`: the label is the `<dt>`, the value the
 * `<dd>`. When `href` is set, a stretched link covers the whole tile so the
 * hit area is the tile, not the words.
 */
export type TileTone = 'neutral' | 'positive' | 'attention' | 'info';

export interface TileProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  readonly tone?: TileTone;
  /** When set the whole tile is a link to this route. */
  readonly href?: string;
  /** Optional `data-testid` on the tile element. */
  readonly testId?: string;
}

/** Accent + value colour per tone. Red stays reserved for verdicts. */
const TONES: Record<TileTone, { readonly accent: string; readonly value: string; readonly surface: string }> = {
  neutral: { accent: cssVar('mutedTint'), value: cssVar('ink'), surface: 'transparent' },
  positive: { accent: cssVar('green'), value: cssVar('greenDeep'), surface: 'transparent' },
  attention: { accent: cssVar('mutedDeep'), value: cssVar('ink'), surface: cssVar('mutedTint') },
  info: { accent: cssVar('blue'), value: cssVar('blueDeep'), surface: 'transparent' },
};

const BOX: CSSProperties = {
  position: 'relative',
  border: `1px solid ${cssVar('mutedTint')}`,
  borderRadius: cssVar('radius-card'),
  padding: SPACE.lg,
  margin: 0,
  minHeight: MIN_TOUCH_TARGET,
};

const LABEL: CSSProperties = {
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  color: cssVar('mutedDeep'),
  margin: 0,
};

const VALUE: CSSProperties = {
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-title'),
  lineHeight: cssVar('leading-title'),
  display: 'block',
  margin: 0,
};

/** Covers the tile so the whole surface is clickable, label included. */
const STRETCH: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: cssVar('radius-card'),
  minHeight: MIN_TOUCH_TARGET,
};

export function Tile(props: TileProps): ReactElement {
  const { label, value, detail, tone = 'neutral', href, testId } = props;
  const [focused, setFocused] = useState(false);
  const palette = TONES[tone];
  const box: CSSProperties = {
    ...BOX,
    background: palette.surface,
    borderLeft: `3px solid ${palette.accent}`,
    ...(focused ? { outline: `2px solid ${cssVar('blue')}`, outlineOffset: 2 } : {}),
  };
  return (
    <div style={box} data-testid={testId} data-tone={tone}>
      <dt style={LABEL}>{label}</dt>
      <dd style={{ margin: 0 }}>
        <span style={{ ...VALUE, color: palette.value }}>{value}</span>
        {detail !== undefined && detail !== null ? (
          <span style={{ ...LABEL, display: 'block' }}>{detail}</span>
        ) : null}
      </dd>
      {href !== undefined ? (
        <Link
          to={href}
          aria-label={label}
          style={STRETCH}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      ) : null}
    </div>
  );
}
