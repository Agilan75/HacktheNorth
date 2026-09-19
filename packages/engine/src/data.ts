/**
 * Typed loaders for the engine's data files. Body owned by Run 1 unit E13.
 *
 * `parse*` is pure: it validates an already-read JSON value and is what every
 * stage and test uses. `read*` is the only I/O in the package, is never called
 * by a stage, and exists so the API and the CLIs have one typed entry point.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  questionFileSchema,
  ratingTableSchema,
  rulebookSchema,
  vectorSpecSchema,
} from './schemas.js';
import type {
  Question,
  RatingTable,
  Rulebook,
  VectorSpec,
  LineOfBusiness,
} from './types.js';

type DataKind = 'rules' | 'vectors' | 'rating' | 'questions';

/** Data files are named by short line key, not by the LineOfBusiness enum. */
const FILE_FOR_LINE: Readonly<Record<LineOfBusiness, string>> = {
  commercial_property: 'commercial',
  tenant: 'tenant',
};

export function parseRulebook(json: unknown): Rulebook {
  return rulebookSchema.parse(json) as Rulebook;
}

export function parseVectorSpec(json: unknown): VectorSpec {
  return vectorSpecSchema.parse(json) as VectorSpec;
}

export function parseRatingTable(json: unknown): RatingTable {
  return ratingTableSchema.parse(json) as RatingTable;
}

export function parseQuestions(json: unknown): Question[] {
  return [...questionFileSchema.parse(json).questions] as Question[];
}

/**
 * Absolute path of a packaged data file, resolved from this module's URL.
 * The data directories sit beside src/ (DECISIONS CP0-4), so V01 can read
 * vectors/ without opening src/.
 */
export function dataFilePath(kind: DataKind, name: string): string {
  return fileURLToPath(new URL(`../${kind}/${name}.json`, import.meta.url));
}

async function readJson(kind: DataKind, name: string): Promise<unknown> {
  return JSON.parse(await readFile(dataFilePath(kind, name), 'utf8')) as unknown;
}

export async function readVectorSpec(line: LineOfBusiness): Promise<VectorSpec> {
  return parseVectorSpec(await readJson('vectors', FILE_FOR_LINE[line]));
}

export async function readRulebook(name: 'commercial' | 'tenant' | 'extensions'): Promise<Rulebook> {
  return parseRulebook(await readJson('rules', name));
}

export async function readRatingTable(line: LineOfBusiness): Promise<RatingTable> {
  return parseRatingTable(await readJson('rating', FILE_FOR_LINE[line]));
}

export async function readQuestions(line: LineOfBusiness): Promise<Question[]> {
  return parseQuestions(await readJson('questions', FILE_FOR_LINE[line]));
}
