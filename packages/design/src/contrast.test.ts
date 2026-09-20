import { describe, expect, it } from 'vitest';
import {
  CONTRAST_EXEMPTIONS,
  contrastMatrix,
  contrastRatio,
  relativeLuminance,
  renderTokenStylesheet,
} from './css';
import { cardStyle, textStyle, touchTargetStyle, verdictPillStyle } from './rn';
import {
  COLORS,
  MOBILE_COLOR_TOKENS,
  VERDICT_MARKS,
  VERDICT_STYLES,
  cssVariableBlock,
} from './tokens';

const find = (fg: string, bg: string) => {
  const hit = contrastMatrix().find((c) => c.foreground === fg && c.background === bg);
  if (!hit) throw new Error(`pair ${fg} on ${bg} not in matrix`);
  return hit;
};

const exempt = (fg: string, bg: string): boolean =>
  CONTRAST_EXEMPTIONS.some(([f, b]) => f === fg && b === bg);

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

  it('measures the palette, including the two pairs that fall short', () => {
    expect(contrastRatio(COLORS.ink, COLORS.bone)).toBeCloseTo(15.351, 2);
    expect(contrastRatio(COLORS.red, COLORS.bone)).toBeCloseTo(4.759, 2);
    expect(contrastRatio(COLORS.mute, COLORS.bone)).toBeCloseTo(3.244, 2);
    expect(contrastRatio(COLORS.accent, COLORS.bone)).toBeCloseTo(2.726, 2);
    expect(contrastRatio(COLORS.amber, COLORS.bone)).toBeCloseTo(2.112, 2);
    expect(contrastRatio(COLORS.ink, COLORS.muteTint)).toBeCloseTo(13.877, 2);
    // Accent and amber only work because ink goes on top of them.
    expect(contrastRatio(COLORS.ink, COLORS.accent)).toBeCloseTo(5.632, 2);
    expect(contrastRatio(COLORS.ink, COLORS.amber)).toBeCloseTo(7.268, 2);
    expect(contrastRatio(COLORS.bone, COLORS.red)).toBeCloseTo(4.759, 2);
  });
});

describe('the palette', () => {
  it('is seven colours, plus aliases the phone app may not name', () => {
    expect(MOBILE_COLOR_TOKENS).toHaveLength(7);
    for (const token of MOBILE_COLOR_TOKENS) {
      expect(COLORS[token], token).toMatch(/^#[0-9A-F]{6}$/);
    }
    // Every alias resolves to one of the seven; none is a colour of its own.
    const real = new Set(MOBILE_COLOR_TOKENS.map((t) => COLORS[t]));
    for (const [name, value] of Object.entries(COLORS)) {
      expect(real.has(value), `${name} is not one of the seven`).toBe(true);
    }
  });

  it('gives each verdict its own fill, and never colour alone', () => {
    expect(VERDICT_STYLES.FIT.fill).toBe(COLORS.accent);
    expect(VERDICT_STYLES.REFER.fill).toBe(COLORS.amber);
    expect(VERDICT_STYLES.DOES_NOT_FIT.fill).toBe(COLORS.red);
    const fills = Object.values(VERDICT_STYLES).map((s) => s.fill);
    expect(new Set(fills).size).toBe(3);
    for (const style of Object.values(VERDICT_STYLES)) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.short.length).toBeGreaterThan(0);
    }
  });
});

describe('contrastMatrix', () => {
  it('reads every verdict pill at AA', () => {
    expect(find(COLORS.ink, COLORS.accent).passesAA).toBe(true); // FIT
    expect(find(COLORS.ink, COLORS.amber).passesAA).toBe(true); // REFER
    expect(find(COLORS.bone, COLORS.red).passesAA).toBe(true); // DOES_NOT_FIT
  });

  it('passes AA everywhere except the two documented exemptions', () => {
    const matrix = contrastMatrix();
    expect(matrix.length).toBeGreaterThanOrEqual(9);
    for (const c of matrix) {
      expect(c.ratio).toBeGreaterThanOrEqual(1);
      expect(c.ratio).toBeLessThanOrEqual(21);
      expect(c.passesAA).toBe(c.ratio >= 4.5);
      if (exempt(c.foreground, c.background)) continue;
      expect(c.passesAALarge, `${c.foreground} on ${c.background} = ${c.ratio}`).toBe(true);
      expect(c.passesAA, `${c.foreground} on ${c.background} = ${c.ratio}`).toBe(true);
    }
  });

  it('holds the exemptions to what they claim: one AA-large, one display-only', () => {
    const mute = find(COLORS.mute, COLORS.bone);
    expect(mute.passesAA).toBe(false);
    expect(mute.passesAALarge).toBe(true);
    // Accent on bone does not even reach AA-large. It is the price and nothing
    // else: display size, with the same figure repeated in ink beneath it.
    const accent = find(COLORS.accent, COLORS.bone);
    expect(accent.passesAA).toBe(false);
    expect(accent.passesAALarge).toBe(false);
    expect(CONTRAST_EXEMPTIONS).toHaveLength(2);
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
    expect(css).toContain('  --rf-bone: #F4EFE6;');
    expect(css).toContain('  --rf-accent: #D97757;');
    expect(css).toContain('  --rf-mute-tint: #E9E4DA;');
    expect(css).toContain('  --rf-min-touch-target: 44px;');
    expect(css).toContain('  --rf-shadow-none: none;');
  });

  it('keeps every legacy variable the console already references', () => {
    const css = renderTokenStylesheet();
    for (const name of ['paper', 'muted', 'muted-deep', 'muted-tint', 'red-deep', 'red-tint', 'blue', 'green']) {
      expect(css, name).toContain(`  --rf-${name}: #`);
    }
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

  it('cardStyle is radius 16, a 1px muteTint border, no shadow', () => {
    expect(cardStyle()).toEqual({
      backgroundColor: COLORS.bone,
      borderWidth: 1,
      borderColor: COLORS.muteTint,
      borderRadius: 16,
      padding: 16,
    });
    expect(cardStyle('xl').padding).toBe(24);
    expect(Object.keys(cardStyle()).some((k) => /shadow|elevation/i.test(k))).toBe(false);
  });

  it('verdictPillStyle always carries its label and its mark', () => {
    for (const v of ['FIT', 'REFER', 'DOES_NOT_FIT'] as const) {
      const pill = verdictPillStyle(v);
      expect(pill.label).toBe(VERDICT_STYLES[v].label);
      expect(pill.label.length).toBeGreaterThan(0);
      expect(pill.mark).toBe(VERDICT_MARKS[v]);
      expect(pill.container.borderRadius).toBe(999);
      expect(pill.text.color).toBe(VERDICT_STYLES[v].text);
    }
    expect(verdictPillStyle('FIT').container.backgroundColor).toBe(COLORS.accent);
    expect(verdictPillStyle('REFER').container.backgroundColor).toBe(COLORS.amber);
    expect(verdictPillStyle('DOES_NOT_FIT').container.backgroundColor).toBe(COLORS.red);
  });

  it('touchTargetStyle never goes below 44', () => {
    expect(touchTargetStyle()).toEqual({ minHeight: 44, minWidth: 44 });
    expect(touchTargetStyle(20)).toEqual({ minHeight: 44, minWidth: 44 });
    expect(touchTargetStyle(56)).toEqual({ minHeight: 56, minWidth: 56 });
    expect(touchTargetStyle(Number.NaN)).toEqual({ minHeight: 44, minWidth: 44 });
  });
});
