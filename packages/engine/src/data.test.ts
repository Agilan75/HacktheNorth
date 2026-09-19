import { describe, expect, it } from 'vitest';
import {
  dataFilePath,
  readQuestions,
  readRatingTable,
  readRulebook,
  readVectorSpec,
} from './data.js';

describe('data loaders read every packaged data file', () => {
  it('resolves data beside src/, not inside it', () => {
    const p = dataFilePath('vectors', 'commercial');
    expect(p).toMatch(/packages\/engine\/vectors\/commercial\.json$/);
    expect(p).not.toMatch(/\/src\//);
  });

  it('loads the commercial vector spec with its 11 components', async () => {
    const spec = await readVectorSpec('commercial_property');
    expect(spec.components).toHaveLength(11);
  });

  it('loads all three rulebooks through the zod schema', async () => {
    for (const name of ['commercial', 'extensions', 'tenant'] as const) {
      const book = await readRulebook(name);
      expect(book.rules.length).toBeGreaterThan(0);
    }
  });

  it('loads both rating tables and the tenant questions', async () => {
    expect((await readRatingTable('commercial_property')).lineOfBusiness).toBe('commercial_property');
    expect((await readRatingTable('tenant')).lineOfBusiness).toBe('tenant');
    expect((await readQuestions('tenant')).length).toBeGreaterThan(0);
  });
});
