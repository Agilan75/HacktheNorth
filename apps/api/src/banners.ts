/**
 * The startup banners. They are never hidden: which adapter is live, whether
 * Gemini is configured, which driver SQLite is using. Unit A10.
 */
import type { Deps } from './services/types';

export interface BannerInput {
  readonly deps: Deps;
  readonly driver: string;
  readonly port: number;
  readonly version: string;
}

export function startupBanner(_input: BannerInput): readonly string[] {
  throw new Error('NOT_IMPLEMENTED:A10');
}
