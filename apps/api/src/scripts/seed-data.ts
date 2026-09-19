/**
 * Seed material: one sweep's observations and one deliberately messy broker
 * reply, so the demo works with no camera and no wifi. Unit A10.
 */
import type { Observation } from '@retrofit/engine';

export function seededObservations(): readonly Observation[] {
  throw new Error('NOT_IMPLEMENTED:A10');
}

/** Vague, partial and partly self-contradicting, on purpose. */
export function seededBrokerReply(): string {
  throw new Error('NOT_IMPLEMENTED:A10');
}
