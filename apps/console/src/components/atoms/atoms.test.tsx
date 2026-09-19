import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { COLORS, VERDICT_STYLES, cssVariableBlock } from '@retrofit/design';

import { Badge } from './Badge.js';
import { Card } from './Card.js';
import { CitationQuote } from './CitationQuote.js';
import { Skeleton } from './Skeleton.js';
import { VerdictPill } from './VerdictPill.js';

afterEach(() => cleanup());

// Vitest stubs CSS imports to '' by default, so read the stylesheets from disk.
const stylesDir = resolve(dirname(import.meta.filename), '../../styles');
const tokensCss = readFileSync(resolve(stylesDir, 'tokens.css'), 'utf8');
const baseCss = readFileSync(resolve(stylesDir, 'base.css'), 'utf8');


describe('tokens.css', () => {
  it('is exactly the @retrofit/design cssVariableBlock()', () => {
    expect(tokensCss).toContain(cssVariableBlock());
  });

  it('carries the PRD 13 values', () => {
    expect(tokensCss).toContain('--rf-paper: #FAF8F2;');
    expect(tokensCss).toContain('--rf-ink: #1F1E1B;');
    expect(tokensCss).toContain('--rf-red: #E4002B;');
    expect(tokensCss).toContain('--rf-radius-card: 16px;');
    expect(tokensCss).toContain('--rf-radius-pill: 999px;');
    expect(tokensCss).toContain('--rf-min-touch-target: 44px;');
    for (const size of [34, 28, 22, 17, 15, 13]) expect(tokensCss).toContain(`${size}px;`);
  });
});

describe('base.css', () => {
  it('never declares a real shadow', () => {
    const shadows = baseCss.match(/box-shadow:\s*[^;]+;/g) ?? [];
    expect(shadows.length).toBeGreaterThan(0);
    for (const s of shadows) expect(s).toMatch(/box-shadow:\s*(none|var\(--rf-shadow-none\));/);
  });

  it('uses only tokens for colour (no raw hex besides white inputs)', () => {
    const hexes = baseCss.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
    expect(hexes.every((h) => h.toLowerCase() === '#fff')).toBe(true);
  });

  it('enforces the 44px target and styles each pill variant from tokens', () => {
    expect(baseCss).toContain('min-height: var(--rf-min-touch-target)');
    expect(baseCss).toMatch(/\.rf-pill--fit\s*{[^}]*background: var\(--rf-red\)/);
    expect(baseCss).toMatch(/\.rf-pill--refer\s*{[^}]*background: transparent[^}]*border-color: var\(--rf-red\)/);
    expect(baseCss).toMatch(/\.rf-pill--does-not-fit\s*{[^}]*background: var\(--rf-ink\)/);
    expect(baseCss).toMatch(/\.rf-card\s*{[^}]*border-radius: var\(--rf-radius-card\)/);
  });
});

describe('VerdictPill', () => {
  it.each([
    ['FIT', 'rf-pill--fit', 'filled', 'FIT', 'Fits appetite', '●'],
    ['REFER', 'rf-pill--refer', 'outlined', 'REFER', 'Refer to underwriter', '◐'],
    ['DOES_NOT_FIT', 'rf-pill--does-not-fit', 'filled', 'DOES NOT FIT', 'Outside appetite', '○'],
  ] as const)('%s renders its word, label, mark and variant', (verdict, cls, variant, word, label, mark) => {
    const { container } = render(<VerdictPill verdict={verdict} />);
    const pill = container.querySelector('.rf-pill');
    expect(pill).not.toBeNull();
    expect(pill!.classList.contains(cls)).toBe(true);
    expect(pill!.getAttribute('data-verdict')).toBe(verdict);
    expect(pill!.getAttribute('data-variant')).toBe(variant);
    expect(pill!.querySelector('.rf-pill__word')!.textContent).toBe(word);
    expect(pill!.textContent).toContain(label);
    expect(pill!.getAttribute('title')).toBe(label);
    const markEl = pill!.querySelector('.rf-pill__mark')!;
    expect(markEl.textContent).toBe(mark);
    expect(markEl.getAttribute('aria-hidden')).toBe('true');
    expect(VERDICT_STYLES[verdict].short).toBe(word);
  });

  it('adds detail after the verdict word without replacing it', () => {
    const { container } = render(<VerdictPill verdict="REFER" detail="Roof age" />);
    const text = container.textContent ?? '';
    expect(text.indexOf('REFER')).toBeLessThan(text.indexOf('Roof age'));
    expect(container.querySelector('.rf-pill')!.getAttribute('title')).toBe(
      'Refer to underwriter: Roof age',
    );
  });

  it('ignores blank detail', () => {
    const { container } = render(<VerdictPill verdict="FIT" detail="   " />);
    expect(container.querySelector('.rf-pill__detail')).toBeNull();
  });
});

describe('Badge', () => {
  it('renders the label with the default neutral tone', () => {
    render(<Badge label="1 flip from FIT" />);
    const el = screen.getByText('1 flip from FIT');
    expect(el.className).toBe('rf-badge rf-badge--neutral');
    expect(el.getAttribute('data-tone')).toBe('neutral');
  });

  it('applies tone and title', () => {
    render(<Badge label="3 contradictions" tone="attention" title="Open contradictions" />);
    const el = screen.getByText('3 contradictions');
    expect(el.classList.contains('rf-badge--attention')).toBe(true);
    expect(el.getAttribute('title')).toBe('Open contradictions');
  });
});

describe('CitationQuote', () => {
  it('renders document, page, row and the exact quote', () => {
    const { container } = render(
      <CitationQuote
        citation={{
          document: 'Property Appetite Guide',
          page: 4,
          row: 'Construction',
          quote: 'Fire resistive construction is a target class.',
        }}
      />,
    );
    expect(container.querySelector('blockquote')!.textContent).toBe(
      '“Fire resistive construction is a target class.”',
    );
    expect(container.querySelector('cite')!.textContent).toBe(
      'Property Appetite Guide · p. 4 · row Construction',
    );
    expect(container.querySelector('.rf-citation--compact')).toBeNull();
  });

  it('omits missing page and row', () => {
    const { container } = render(
      <CitationQuote citation={{ document: 'Rulebook', page: null, row: null, quote: 'x' }} />,
    );
    expect(container.querySelector('cite')!.textContent).toBe('Rulebook');
  });

  it('keeps page 0 when present', () => {
    const { container } = render(
      <CitationQuote citation={{ document: 'Doc', page: 0, quote: 'x' }} />,
    );
    expect(container.querySelector('cite')!.textContent).toBe('Doc · p. 0');
  });

  it('compact truncates long quotes but keeps the full text in the title', () => {
    const long = 'word '.repeat(60).trim();
    const { container } = render(
      <CitationQuote compact citation={{ document: 'Doc', page: 2, quote: long }} />,
    );
    const bq = container.querySelector('blockquote')!;
    expect(container.querySelector('.rf-citation--compact')).not.toBeNull();
    expect(bq.textContent!.endsWith('…”')).toBe(true);
    expect(bq.textContent!.length).toBeLessThanOrEqual(120 + 3);
    expect(bq.textContent!.startsWith('“word word')).toBe(true);
    expect(bq.getAttribute('title')).toBe(long);
  });

  it('compact leaves short quotes whole with no title', () => {
    const { container } = render(
      <CitationQuote compact citation={{ document: 'Doc', quote: 'Short quote.' }} />,
    );
    const bq = container.querySelector('blockquote')!;
    expect(bq.textContent).toBe('“Short quote.”');
    expect(bq.hasAttribute('title')).toBe(false);
  });
});

describe('Skeleton', () => {
  it('announces its label as a busy status with 3 lines by default', () => {
    render(<Skeleton label="Loading queue" />);
    const status = screen.getByRole('status', { name: 'Loading queue' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.querySelectorAll('.rf-skeleton__line').length).toBe(3);
  });

  it('honours lines, clamps nonsense, and shortens the last line', () => {
    const { container, rerender } = render(<Skeleton label="x" lines={5} width="240px" />);
    const lines = container.querySelectorAll<HTMLElement>('.rf-skeleton__line');
    expect(lines.length).toBe(5);
    expect(lines[4]!.style.width).toBe('60%');
    expect(lines[0]!.style.width).toBe('100%');
    expect(container.querySelector<HTMLElement>('.rf-skeleton')!.style.width).toBe('240px');
    rerender(<Skeleton label="x" lines={0} />);
    expect(container.querySelectorAll('.rf-skeleton__line').length).toBe(1);
    rerender(<Skeleton label="x" lines={Number.NaN} />);
    expect(container.querySelectorAll('.rf-skeleton__line').length).toBe(3);
  });
});

describe('Card', () => {
  it('renders a labelled section with anchor id, aside and children', () => {
    render(
      <Card title="Score breakdown" anchorId="b" aside={<Badge label="8 factors" />}>
        <p>body</p>
      </Card>,
    );
    const region = screen.getByRole('region', { name: 'Score breakdown' });
    expect(region.id).toBe('b');
    expect(region.classList.contains('rf-card')).toBe(true);
    expect(region.querySelector('.rf-card__aside')!.textContent).toBe('8 factors');
    expect(region.querySelector('.rf-card__body')!.textContent).toBe('body');
  });

  it('omits the aside and anchor when not given', () => {
    const { container } = render(<Card title="Rules">x</Card>);
    const section = container.querySelector('section')!;
    expect(section.hasAttribute('id')).toBe(false);
    expect(container.querySelector('.rf-card__aside')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeDefined();
  });

  it('keeps colour tokens aligned with PRD 13', () => {
    expect(COLORS.mutedTint).toBe('#EDEFE8');
  });
});
