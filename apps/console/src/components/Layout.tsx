import { NavLink } from 'react-router';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';

export interface NavItem {
  readonly to: string;
  readonly label: string;
}

export interface LayoutProps {
  readonly nav: readonly NavItem[];
  /**
   * The adapter banner slot. App.tsx always passes it and Layout must always
   * render it inside the header — PRD §10: never hidden.
   */
  readonly banner: ReactNode;
  readonly children: ReactNode;
}

const MAIN_ID = 'rf-main';

const shellStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: cssVar('paper'),
  color: cssVar('ink'),
  fontFamily: cssVar('font-body'),
};

const skipLinkStyle: CSSProperties = {
  position: 'absolute',
  left: SPACE.lg,
  top: -100,
  padding: SPACE.sm,
  background: cssVar('ink'),
  color: cssVar('paper'),
  borderRadius: RADIUS.card,
  zIndex: 10,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: SPACE.lg,
  padding: `${SPACE.md}px ${SPACE.xl}px`,
  borderBottom: `1px solid ${cssVar('muted-tint')}`,
  background: cssVar('paper'),
};

const brandStyle: CSSProperties = {
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-heading'),
  lineHeight: cssVar('leading-heading'),
  margin: 0,
};

const navListStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: SPACE.xs,
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

function navLinkStyle({ isActive }: { isActive: boolean }): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    padding: `0 ${SPACE.md}px`,
    borderRadius: RADIUS.pill,
    textDecoration: isActive ? 'underline' : 'none',
    textUnderlineOffset: 4,
    fontWeight: isActive ? 600 : 400,
    color: cssVar('ink'),
    background: isActive ? cssVar('muted-tint') : 'transparent',
  };
}

const mainStyle: CSSProperties = {
  flex: 1,
  width: '100%',
  maxWidth: 1440,
  margin: '0 auto',
  padding: `${SPACE.xl}px`,
  boxSizing: 'border-box',
};

/**
 * Console shell: skip link, header (brand, primary nav, adapter banner), main.
 * The banner is rendered unconditionally in the header on every route —
 * PRD §10 "Never hidden".
 */
export function Layout(props: LayoutProps): ReactElement {
  const { nav, banner, children } = props;
  return (
    <div style={shellStyle}>
      <a
        href={`#${MAIN_ID}`}
        style={skipLinkStyle}
        onFocus={(event) => {
          event.currentTarget.style.top = `${SPACE.sm}px`;
        }}
        onBlur={(event) => {
          event.currentTarget.style.top = '-100px';
        }}
      >
        Skip to content
      </a>
      <header style={headerStyle}>
        <p style={brandStyle}>Retrofit</p>
        <nav aria-label="Primary" style={{ flex: '1 1 auto' }}>
          <ul style={navListStyle}>
            {nav.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} style={navLinkStyle}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div data-testid="adapter-banner-slot">{banner}</div>
      </header>
      <main id={MAIN_ID} tabIndex={-1} style={mainStyle}>
        {children}
      </main>
    </div>
  );
}
