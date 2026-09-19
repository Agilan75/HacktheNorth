/**
 * Typed loaders for the engine's data files. Body owned by Run 1 unit E13.
 *
 * `parse*` is pure: it validates an already-read JSON value and is what every
 * stage and test uses. `read*` is the only I/O in the package, is never called
 * by a stage, and exists so the API and the CLIs have one typed entry point.
 */
import type {
  Question,
  RatingTable,
  Rulebook,
  VectorSpec,
  LineOfBusiness,
} from './types.js';

export function parseRulebook(_json: unknown): Rulebook {
  throw new Error('NOT_IMPLEMENTED:E13');
}

export function parseVectorSpec(_json: unknown): VectorSpec {
  throw new Error('NOT_IMPLEMENTED:E13');
}

export function parseRatingTable(_json: unknown): RatingTable {
  throw new Error('NOT_IMPLEMENTED:E13');
}

export function parseQuestions(_json: unknown): Question[] {
  throw new Error('NOT_IMPLEMENTED:E13');
}

/** Absolute path of a packaged data file, resolved from this module's URL. */
export function dataFilePath(
  _kind: 'rules' | 'vectors' | 'rating' | 'questions',
  _name: string,
): string {
  throw new Error('NOT_IMPLEMENTED:E13');
}

export function readVectorSpec(_line: LineOfBusiness): Promise<VectorSpec> {
  throw new Error('NOT_IMPLEMENTED:E13');
}

export function readRulebook(_name: 'commercial' | 'tenant' | 'extensions'): Promise<Rulebook> {
  throw new Error('NOT_IMPLEMENTED:E13');
}

export function readRatingTable(_line: LineOfBusiness): Promise<RatingTable> {
  throw new Error('NOT_IMPLEMENTED:E13');
}

export function readQuestions(_line: LineOfBusiness): Promise<Question[]> {
  throw new Error('NOT_IMPLEMENTED:E13');
}
