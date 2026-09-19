/**
 * FROZEN (W0-4) — the @retrofit/verify barrel, PRD §12.
 *
 * `src/naive/**` is deliberately NOT re-exported here: it is written in
 * isolation by V01 from packages/verify/spec/NAIVE_SPEC.md, and the comparator
 * is the only module that pulls it in.
 */
export * from './types.js';
export * from './gen/prng.js';
export * from './gen/vectors.js';
export * from './gen/submissions.js';
export * from './gen/stratify.js';
export * from './invariants/core.js';
export * from './invariants/monotonic.js';
export * from './invariants/flip.js';
export * from './invariants/vector.js';
export * from './compare.js';
export * from './facts.js';
export * from './wilson.js';
export * from './report.js';
export * from './pool.js';
export * from './layer-c.js';
