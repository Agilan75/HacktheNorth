import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verificationResponseSchema } from '@retrofit/contracts';
import type { EngineResult } from '@retrofit/engine';
import {
  accountVerification,
  buildVerification,
  extractionReason,
  parseDefects,
  parsePerAccount,
  readSources,
  verification,
} from './verification';
import type { SourceTexts } from './verification';

const repo = (rel: string): string => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const read = (rel: string): string => readFileSync(repo(rel), 'utf8');
const json = <T>(rel: string): T => JSON.parse(read(rel)) as T;

const NONE: SourceTexts = {
  run: null,
  summary: null,
  layerC: null,
  perAccount: null,
  verificationMd: null,
  decisionsMd: null,
};

describe('verification() over the committed files', () => {
  const v = verificationResponseSchema.parse(verification());

  it('serves layers A+B exactly as run.json records them', () => {
    const run = json<{
      completed: number;
      invariantViolations: number;
      disagreements: number;
      errors: number;
      config: { total: number; seed: number; workers: number };
    }>('packages/verify/out/run.json');
    expect(v.layersAB).toMatchObject({
      requested: run.config.total,
      completed: run.completed,
      seed: run.config.seed,
      workers: run.config.workers,
      invariantViolations: run.invariantViolations,
      disagreements: run.disagreements,
      errors: run.errors,
    });
  });

  it('serves layer C with its interval, per-stratum table and every disagreement with both sides', () => {
    const lc = json<{
      summary: {
        total: number;
        agreed: number;
        agreement: { low: number; high: number };
        byStratum: { stratum: string }[];
        disagreements: { caseId: string; model: { reasoning: string } }[];
      };
      errors: unknown[];
      decidingFactorAgreed: number;
    }>('packages/verify/out/layer-c.json');
    const c = v.layerC!;
    expect(c.judged).toBe(lc.summary.total);
    expect(c.agreed).toBe(lc.summary.agreed);
    expect(c.unanswered).toBe(lc.errors.length);
    expect(c.decidingFactorAgreed).toBe(lc.decidingFactorAgreed);
    expect(c.agreement.low).toBe(lc.summary.agreement.low);
    expect(c.agreement.high).toBe(lc.summary.agreement.high);
    expect(c.byStratum.map((s) => s.stratum)).toEqual(lc.summary.byStratum.map((s) => s.stratum));
    for (const s of c.byStratum) expect(s.rate).toBe(s.agreed / s.total);
    expect(c.disagreements.map((d) => d.caseId)).toEqual(lc.summary.disagreements.map((d) => d.caseId));
    for (const d of c.disagreements) {
      expect(d.engine.verdict).toBeDefined();
      expect(d.model.reasoning.length).toBeGreaterThan(0);
      expect(d.model.verdict).not.toBe(d.engine.verdict);
    }
  });

  it('summarises the 38 real accounts from per-account.json', () => {
    const pa = json<{ summary: { total: number; secondOpinionAgreed: number } }>('packages/verify/out/per-account.json');
    expect(v.realAccounts).toMatchObject({ total: pa.summary.total, secondOpinionAgreed: pa.summary.secondOpinionAgreed });
    expect(v.realAccounts!.total).toBe(38);
  });

  it('reports extraction as not measured, with the reason, and never the discarded score', () => {
    expect(v.extraction.status).toBe('not_measured');
    expect(v.extraction.fieldAccuracy).toBeNull();
    expect(v.extraction.reason).toMatch(/402/);
    expect(v.extraction.reason).toMatch(/verify:llm/);
    const everything = JSON.stringify(v);
    expect(everything).not.toMatch(/41%|21 of 51|0\.41/);
  });

  it('lists the defects the testing found, parsed from DECISIONS.md and VERIFICATION.md', () => {
    const d = v.defectsFound;
    const verificationMd = read('VERIFICATION.md');
    const decisionsMd = read('DECISIONS.md');
    // Every count is one that appears in the source text.
    expect(verificationMd).toContain(`${d.cp1InvariantViolations!.toLocaleString('en-US')} invariant violations`);
    expect(verificationMd).toContain(`${d.cp1Disagreements!.toLocaleString('en-US')} engine-vs-naive disagreements`);
    expect(decisionsMd).toMatch(new RegExp(`${d.run2Confirmed} findings were\\s+confirmed, ${d.run2Refuted} refuted`));
    const ids = d.defects.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['CP1-2', 'CP1-4', 'CP1-5', 'R2-3']));
    const overflow = d.defects.find((x) => x.id === 'CP1-4')!;
    expect(overflow.phase).toBe('CP1');
    expect(overflow.title).toMatch(/Peer distance/);
    const location = d.defects.find((x) => x.id === 'R2-3')!;
    expect(location.phase).toBe('Run 2');
    expect(location.detail).toMatch(/11 of the 27/);
    for (const x of d.defects) {
      expect(x.title).not.toContain('**');
      expect(decisionsMd).toContain(`| ${x.id} |`);
    }
  });

  it('names every file it read', () => {
    expect(v.sources).toEqual([
      'packages/verify/out/run.json',
      'packages/verify/out/summary.json',
      'packages/verify/out/layer-c.json',
      'packages/verify/out/per-account.json',
      'VERIFICATION.md',
      'DECISIONS.md',
    ]);
  });
});

describe('buildVerification with files absent', () => {
  it('leaves every block whose file is missing null or empty, never filled in', () => {
    const v = verificationResponseSchema.parse(buildVerification(NONE));
    expect(v.layersAB).toBeNull();
    expect(v.layerC).toBeNull();
    expect(v.realAccounts).toBeNull();
    expect(v.extraction).toEqual({ status: 'not_measured', fieldAccuracy: null, reason: null });
    expect(v.defectsFound).toEqual({
      cp1InvariantViolations: null,
      cp1Disagreements: null,
      run2Confirmed: null,
      run2Refuted: null,
      defects: [],
    });
    expect(v.sources).toEqual([]);
  });

  it('reports a measured extraction accuracy when summary.json carries one', () => {
    const v = buildVerification({ ...NONE, summary: JSON.stringify({ extractionFieldAccuracy: 0.9 }) });
    expect(v.extraction).toEqual({ status: 'measured', fieldAccuracy: 0.9, reason: null });
  });

  it('throws on a corrupt file rather than serving a wrong number', () => {
    expect(() => buildVerification({ ...NONE, run: '{not json' })).toThrow(/run\.json/);
    expect(() => buildVerification({ ...NONE, layerC: '{}' })).toThrow(/layer-c\.json/);
  });

  it('readSources returns null for a file that does not exist', () => {
    const texts = readSources({
      run: repo('packages/verify/out/does-not-exist.json'),
      summary: repo('packages/verify/out/does-not-exist.json'),
      layerC: repo('packages/verify/out/does-not-exist.json'),
      perAccount: repo('packages/verify/out/does-not-exist.json'),
      verificationMd: repo('does-not-exist.md'),
      decisionsMd: repo('does-not-exist.md'),
    });
    expect(Object.values(texts).every((t) => t === null)).toBe(true);
  });
});

describe('extractionReason', () => {
  it('keeps the explanation and the way to measure it, and stops before any score', () => {
    const md = [
      '# V',
      '## Extraction check',
      '',
      '**Not measured.** The check scores replies. The credits ran out: every call returned HTTP 402. The resulting score (21 of 51 fields, 41%) measures the billing failure. It was discarded.',
      '',
      'Another paragraph.',
      '',
      'To measure it: top up, then run `npm run verify:llm`.',
      '## Next',
      'ignored',
    ].join('\n');
    expect(extractionReason(md)).toBe(
      'The check scores replies. The credits ran out: every call returned HTTP 402. To measure it: top up, then run `npm run verify:llm`.',
    );
  });

  it('is null without the section', () => {
    expect(extractionReason('# nothing here')).toBeNull();
  });
});

describe('parseDefects', () => {
  it('reads a row title from its bold lead and the detail from its why column', () => {
    const decisions = [
      '| # | Decision | Why | Rejected |',
      '| CP1-4 | **Peer distance clamps.** More text. | 7 violations, all `x`. | — |',
      '**3 findings were',
      'confirmed, 2 refuted.**',
    ].join('\n');
    const d = parseDefects(decisions, null);
    expect(d.defects).toEqual([{ id: 'CP1-4', phase: 'CP1', title: 'Peer distance clamps.', detail: '7 violations, all `x`.' }]);
    expect(d.run2Confirmed).toBe(3);
    expect(d.run2Refuted).toBe(2);
  });
});

describe('accountVerification', () => {
  const file = parsePerAccount(read('packages/verify/out/per-account.json'))!;
  const resultAt = (verdict: string, score: number): EngineResult =>
    ({ verdict: { verdict }, evaluate: { appetiteScore: score } }) as unknown as EngineResult;

  it('is null for an account the verification did not cover, or with no file', () => {
    expect(accountVerification(file, 'SUB-NOT-REAL', resultAt('FIT', 88))).toBeNull();
    expect(accountVerification(null, 'SUB-2026-00081', resultAt('FIT', 88))).toBeNull();
  });

  it('compares the stored result with the verified one within the score tolerance', () => {
    const rec = file.accounts['SUB-2026-00081']!;
    expect(accountVerification(file, 'SUB-2026-00081', resultAt(rec.engine.verdict, rec.engine.appetiteScore + 1e-9))?.matchesCurrentResult).toBe(true);
    expect(accountVerification(file, 'SUB-2026-00081', resultAt(rec.engine.verdict, rec.engine.appetiteScore + 1))?.matchesCurrentResult).toBe(false);
    expect(accountVerification(file, 'SUB-2026-00081', resultAt('REFER', rec.engine.appetiteScore))?.matchesCurrentResult).toBe(false);
  });
});
