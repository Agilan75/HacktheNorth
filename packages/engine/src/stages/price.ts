/** Stage 8 — price. Body owned by Run 1 unit E07. */
import type {
  BookStats,
  CanonicalSubmission,
  CommercialRatingTable,
  ExpectedLossDetail,
  FeatureVector,
  PeerResult,
  PriceBreakdown,
  RatingTable,
  TenantRatingTable,
  VectorSpec,
} from '../types.js';

export function price(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _table: RatingTable,
  _submission: CanonicalSubmission,
  _bookStats: BookStats | null,
  _peers: PeerResult | null,
): PriceBreakdown {
  throw new Error('NOT_IMPLEMENTED:E07');
}

export function priceCommercial(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _table: CommercialRatingTable,
  _submission: CanonicalSubmission,
): PriceBreakdown {
  throw new Error('NOT_IMPLEMENTED:E07');
}

export function priceTenant(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _table: TenantRatingTable,
): PriceBreakdown {
  throw new Error('NOT_IMPLEMENTED:E07');
}

/** Own frequency x severity blended with peers by n / (n + k). */
export function expectedAnnualLoss(
  _submission: CanonicalSubmission,
  _peers: PeerResult | null,
  _bookStats: BookStats | null,
  _credibilityK: number,
): ExpectedLossDetail | null {
  throw new Error('NOT_IMPLEMENTED:E07');
}
