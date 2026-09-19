/**
 * CSS export for the console. Stub frozen by W0-4; unit D01 replaces these
 * bodies only. The token values themselves live in `tokens.ts` and are final.
 */

export interface CssExportOptions {
  /** Selector for the custom-property block. Default `:root`. */
  readonly selector?: string;
  /** Header comment written at the top of the generated file. */
  readonly banner?: string;
}

/** The full contents of `apps/console/src/styles/tokens.css`. */
export function renderTokenStylesheet(_options?: CssExportOptions): string {
  throw new Error('NOT_IMPLEMENTED:D01');
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(_hex: string): number {
  throw new Error('NOT_IMPLEMENTED:D01');
}

/** Contrast ratio between two `#rrggbb` colours, 1–21. */
export function contrastRatio(_foreground: string, _background: string): number {
  throw new Error('NOT_IMPLEMENTED:D01');
}

export interface ContrastCheck {
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly passesAA: boolean;
  readonly passesAALarge: boolean;
}

/** Every foreground/background pair the design system actually uses. */
export function contrastMatrix(): readonly ContrastCheck[] {
  throw new Error('NOT_IMPLEMENTED:D01');
}
