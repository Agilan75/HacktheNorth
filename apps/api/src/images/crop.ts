/**
 * Crops a frame to a Gemini `box_2d` for the hazard detail screen.
 * Body owned by Run 1 unit A09.
 */
export interface CropRequest {
  readonly data: Uint8Array;
  /** `[y0, x0, y1, x1]` in 0..1000, as Gemini returns it. */
  readonly box2d: readonly [number, number, number, number];
  /** Extra margin as a share of the box, e.g. 0.1. */
  readonly padding?: number;
}

export function cropToBox(_request: CropRequest): Promise<Uint8Array> {
  throw new Error('NOT_IMPLEMENTED:A09');
}
