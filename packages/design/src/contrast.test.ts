import { describe, expect, it } from 'vitest';
import {
  contrastMatrix,
  contrastRatio,
  relativeLuminance,
  renderTokenStylesheet,
} from './css';
import { cardStyle, textStyle, touchTargetStyle, verdictPillStyle } from './rn';
import { COLORS, VERDICT_MARKS, VERDICT_STYLES, cssVariableBlock } from './tokens';

const find = (fg: string, bg: string) => {
  const hit = contrastMatrix().find((c) => c.foreground === fg && c.background === bg);
  if (!hit) throw new Error(`pair ${fg} on ${bg} not in matrix`);
  return hit;
};

describe('relativeLuminance / contrastRatio (WCAG 2.x)', () => {
  it('pins the endpoints', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('matches known WCAG reference values', () => {
    // #767676 on white is the canonical 4.54:1 grey.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(relativeLuminance('#FF0000')).toBeCloseTo(0.2126, 4);
  });

  it('rejects malformed colours', () => {
    expect(() => relativeLuminance('red')).toThrow();
    expect(() => relativeLuminance('#12345')).toThrow();
  });

  it('computes the design-system ratios', () => {
    expect(contrastRatio(COLORS.ink, COLORS.paper)).toBeCloseTo(15.696, 2);
    expect(contrastRatio(COLORS.paper, COLORS.red)).toBeCloseTo(4.563, 2);
    expect(contrastRatio(COLORS.redDeep, COLORS.paper)).toBeCloseTo(6.46, 2);
    expect(contrastRatio(COLORS.mutedDeep, COLORS.paper)).toBeCloseTo(5.819, 2);
    expect(contrastRatio(COLORS.muted, COLORS.paper)).toBeCloseTo(3.808, 2);
    expect(contrastRatio(COLORS.redDeep, COLORS.redTint)).toBeCloseTo(5.629, 2);
  });
});

describe('contrastMatrix', () => {
  it('covers every verdict pill, on Paper when outlined', () => {
    expect(find(COLORS.paper, COLORS.red).passesAA).toBe(true); // FIT
    expect(find(COLORS.redDeep, COLORS.paper).passesAA).toBe(true); // REFER
    expect(find(COLORS.paper, COLORS.ink).passesAA).toBe(true); // DOES_NOT_FIT
  });

  it('every pair except Muted-on-Paper passes AA; Muted passes AA-large only', () => {
    const matrix = contrastMatrix();
    expect(matrix.length).toBeGreaterThanOrEqual(11);
    for (const c of matrix) {
      expect(c.ratio).toBeGreaterThanOrEqual(1);
      expect(c.ratio).toBeLessThanOrEqual(21);
      expect(c.passesAALarge).toBe(true);
      expect(c.passesAA).toBe(c.ratio >= 4.5);
      if (!(c.foreground === COLORS.muted && c.background === COLORS.paper)) {
        expect(c.passesAA, `${c.foreground} on ${c.background} = ${c.ratio}`).toBe(true);
      }
    }
    const muted = find(COLORS.muted, COLORS.paper);
    expect(muted.passesAA).toBe(false);
    expect(muted.passesAALarge).toBe(true);
  });

  it('has no duplicate pairs', () => {
    const keys = contrastMatrix().map((c) => `${c.foreground}|${c.background}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('renderTokenStylesheet', () => {
  it('is a banner comment followed by the exact token block', () => {
    const css = renderTokenStylesheet();
    expect(css.startsWith('/*\n')).toBe(true);
    expect(css.endsWith(cssVariableBlock(':root'))).toBe(true);
    expect(css).toContain('  --rf-red-deep: #B80022;');
    expect(css).toContain('  --rf-min-touch-target: 44px;');
    expect(css).toContain('  --rf-shadow-none: none;');
  });

  it('honours selector and banner, and cannot be broken by a */ in the banner', () => {
    const css = renderTokenStylesheet({ selector: '.rf-scope', banner: 'hi */ there' });
    expect(css).toContain('.rf-scope {\n');
    expect(css.indexOf('*/')).toBe(css.indexOf('*/\n.rf-scope'));
    expect(renderTokenStylesheet({ banner: '' })).toBe(cssVariableBlock(':root'));
  });
});

describe('React Native helpers', () => {
  it('textStyle maps the six steps at scale 1', () => {
    expect(textStyle('display')).toEqual({
      fontFamily: 'Fraunces',
      fontSize: 34,
      lineHeight: 40,
      fontWeight: '600',
      color: COLORS.ink,
    });
    expect(textStyle('body')).toMatchObject({ fontFamily: 'Inter', fontSize: 17, lineHeight: 24 });
    expect(textStyle('micro')).toMatchObject({ fontSize: 13, lineHeight: 16 });
  });

  it('textStyle applies dynamic type on the 4pt grid, clamped', () => {
    const big = textStyle('body', 1.5);
    expect(big.fontSize).toBe(26);
    expect(big.lineHeight).toBe(36);
    expect((big.lineHeight ?? 0) % 4).toBe(0);
    expect(textStyle('body', 10).fontSize).toBe(Math.round(17 * 3.2));
    expect(textStyle('body', 0.1).fontSize).toBe(Math.round(17 * 0.8));
    expect(textStyle('body', Number.NaN).fontSize).toBe(17);
    for (const s of [0.8, 1, 1.35, 2, 3.2]) {
      const t = textStyle('display', s);
      expect(t.lineHeight ?? 0).toBeGreaterThanOrEqual(t.fontSize ?? 0);
    }
  });

  it('cardStyle is radius 16, 1px Muted-tint border, no shadow', () => {
    expect(cardStyle()).toEqual({
      backgroundColor: COLORS.paper,
      borderWidth: 1,
      borderColor: COLORS.mutedTint,
      borderRadius: 16,
      padding: 16,
    });
    expect(cardStyle('xl').padding).toBe(24);
    expect(Object.keys(cardStyle()).some((k) => /shadow|elevation/i.test(k))).toBe(false);
  });

  it('verdictPillStyle always carries label and mark; red never means bad', () => {
    for (const v of ['FIT', 'REFER', 'DOES_NOT_FIT'] as const) {
      const pill = verdictPillStyle(v);
      expect(pill.label).toBe(VERDICT_STYLES[v].label);
      expect(pill.label.length).toBeGreaterThan(0);
      expect(pill.mark).toBe(VERDICT_MARKS[v]);
      expect(pill.container.borderRadius).toBe(999);
      expect(pill.text.color).toBe(VERDICT_STYLES[v].text);
    }
    expect(verdictPillStyle('FIT').container.backgroundColor).toBe(COLORS.red);
    expect(verdictPillStyle('REFER').container.backgroundColor).toBe('transparent');
    expect(verdictPillStyle('REFER').container.borderColor).toBe(COLORS.red);
    expect(verdictPillStyle('DOES_NOT_FIT').container.backgroundColor).toBe(COLORS.ink);
  });

  it('touchTargetStyle never goes below 44', () => {
    expect(touchTargetStyle()).toEqual({ minHeight: 44, minWidth: 44 });
    expect(touchTargetStyle(20)).toEqual({ minHeight: 44, minWidth: 44 });
    expect(touchTargetStyle(56)).toEqual({ minHeight: 56, minWidth: 56 });
    expect(touchTargetStyle(Number.NaN)).toEqual({ minHeight: 44, minWidth: 44 });
  });
});
