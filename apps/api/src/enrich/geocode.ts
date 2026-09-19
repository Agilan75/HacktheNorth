/** Nominatim geocoding — only when a location has no coordinates. Unit A07. */
import type { EnrichLocation } from './types';

export interface GeocodeResult {
  readonly latitude: number;
  readonly longitude: number;
  readonly matchedAddress: string;
}

export function geocode(_location: EnrichLocation): Promise<GeocodeResult | null> {
  throw new Error('NOT_IMPLEMENTED:A07');
}
