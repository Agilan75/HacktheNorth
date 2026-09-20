import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeLlm } from '../../../apps/api/src/llm/index';
import type { GenerateJsonRequest, GenerateJsonResult, LlmProvider } from '../../../apps/api/src/llm/index';

import { main, setCliLlmDeps } from './cli-llm.js';
import { REFERENCE_INPUTS, engineViewForInput } from './compare.js';
import { REAL_STRATUM, configureLayerC, judgeOne, lastLayerCRun, runLayerC } from './layer-c.js';
import type { LayerCRealCase } from './layer-c.js';
import { stratifiedSample } from './gen/stratify.js';
import type { LayerCConfig } from './types.js';
import { wilsonInterval } from './wilson.js';

/** INTERPRETATIONS §8 B1..B12, in order, as "real" cases. */
const REAL: readonly LayerCRealCase[] = REFERENCE_INPUTS.map((input, i) => ({ caseId: `B${i + 1}`, input }));
/** INTERPRETATIONS §8 expected verdicts for B1..B12. */
const EXPECTED = [
  'FIT', // B1
  'DOES_NOT_FIT', // B2 TIV over $150M
  'DOES_NOT_FIT', // B3 premium under $50K
  'DOES_NOT_FIT', // B4 loss over $100K
  'DOES_NOT_FIT', // B5 construction under half
  'REFER', // B6 exactly half pre-1990
  'DOES_NOT_FIT', // B7 just over half pre-1990
  'FIT', // B8
  'FIT', // B9
  'FIT', // B10
  'REFER', // B11 premium missing
  'DOES_NOT_FIT', // B12 renewal
] as const;

const answer = (verdict: string, decidingFactor = 'tiv') => ({
  verdict,
  decidingFactor,
  reasoning: `The guideline says ${verdict}.`,
});

let dir: string;
const cfg = (over: Partial<LayerCConfig> = {}): LayerCConfig => ({
  generatedCount: 0,
  seed: 7,
  concurrency: 2,
  cacheDir: join(dir, 'cache'),
  outDir: join(dir, 'out'),
  resume: true,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'v09-layer-c-'));
});
afterEach(() => {
  configureLayerC({ llm: null });
  setCliLlmDeps({});
  rmSync(dir, { recursive: true, force: true });
});

describe('runLayerC', () => {
  it('scores agreement on verdict against the engine for the B1..B12 boundary cases', async () => {
    const llm = createFakeLlm({ overrides: { 'second-opinion': answer('REFER', 'building_age') } });
    configureLayerC({ llm, realCases: REAL });
    const s = await runLayerC(cfg());

    // The engine side matches INTERPRETATIONS §8 exactly.
    expect(REAL.map((r) => engineViewForInput(r.input).verdict)).toEqual(EXPECTED);

    // Model always says REFER: only B6 and B11 agree.
    expect(s.total).toBe(12);
    expect(s.agreed).toBe(2);
    expect(s.agreement).toEqual(wilsonInterval(2, 12));
    expect(s.agreement.point).toBeCloseTo(2 / 12, 12);
    expect(s.byStratum).toEqual([{ stratum: REAL_STRATUM, total: 12, agreed: 2 }]);
    expect(s.disagreements.map((d) => d.caseId)).toEqual(
      ['B1', 'B2', 'B3', 'B4', 'B5', 'B7', 'B8', 'B9', 'B10', 'B12'].map((id) => `real:${id}`),
    );
    const b2 = s.disagreements.find((d) => d.caseId === 'real:B2')!;
    expect(b2.engine.verdict).toBe('DOES_NOT_FIT');
    expect(b2.engine.decidingFactorId).toBe('tiv');
    expect(b2.model.verdict).toBe('REFER');
    expect(b2.cached).toBe(false);
    expect(llm.callsFor('second-opinion')).toHaveLength(12);

    const detail = lastLayerCRun()!;
    expect(detail.realCases).toBe(12);
    expect(detail.errors).toEqual([]);
    expect(detail.decidingFactorAgreed).toBe(
      detail.results.filter((r) => r.agreed && r.engine.decidingFactorId === 'building_age').length,
    );

    const written = JSON.parse(readFileSync(join(dir, 'out', 'layer-c.json'), 'utf8'));
    expect(written.summary.total).toBe(12);
    expect(written.results).toHaveLength(12);
  });

  it('never shows the model engine output: the prompt holds the guideline and the facts only', async () => {
    const llm = createFakeLlm({ overrides: { 'second-opinion': answer('FIT') } });
    configureLayerC({ llm, realCases: REAL.slice(0, 1) });
    await runLayerC(cfg());
    const [call] = llm.callsFor('second-opinion');
    expect(call!.prompt).toContain('=== GUIDELINE TEXT ===');
    expect(call!.prompt).toContain('TIV (total insured value): $150,000,000');
    expect(call!.prompt).not.toMatch(/appetite score|knockout|real:B1|tierValue|84\.0/i);
  });

  it('resumes from the disk cache and makes no model call for a cached case', async () => {
    const llm = createFakeLlm({ overrides: { 'second-opinion': answer('FIT') } });
    configureLayerC({ llm, realCases: REAL });
    const first = await runLayerC(cfg());
    expect(llm.callsFor('second-opinion')).toHaveLength(12);
    expect(readdirSync(join(dir, 'cache')).filter((f) => f.endsWith('.json'))).toHaveLength(12);

    llm.reset();
    const second = await runLayerC(cfg());
    expect(llm.callsFor('second-opinion')).toHaveLength(0);
    expect(second.agreed).toBe(first.agreed);
    expect(second.agreed).toBe(4); // B1, B8, B9, B10 are FIT
    expect(lastLayerCRun()!.cachedCases).toBe(12);
    expect(second.disagreements.every((d) => d.cached)).toBe(true);

    // --no-resume ignores the cache and asks again.
    llm.reset();
    await runLayerC(cfg({ resume: false }));
    expect(llm.callsFor('second-opinion')).toHaveLength(12);
  });

  it('treats a cache entry from another provider or another prompt as a miss', async () => {
    const llm = createFakeLlm({ overrides: { 'second-opinion': answer('FIT') } });
    configureLayerC({ llm, realCases: REAL.slice(0, 2) });
    await runLayerC(cfg());
    const files = readdirSync(join(dir, 'cache')).filter((f) => f.endsWith('.json'));
    const [a, b] = files.map((f) => join(dir, 'cache', f));
    const ea = JSON.parse(readFileSync(a!, 'utf8'));
    writeFileSync(a!, JSON.stringify({ ...ea, provider: 'gemini' }));
    const eb = JSON.parse(readFileSync(b!, 'utf8'));
    writeFileSync(b!, JSON.stringify({ ...eb, promptKey: 'stale' }));

    llm.reset();
    await runLayerC(cfg());
    expect(llm.callsFor('second-opinion')).toHaveLength(2);
  });

  it('records a failed call as unanswered, keeps it out of the counts, and retries it on resume', async () => {
    const failing = createFakeLlm({ failFor: ['second-opinion'] });
    configureLayerC({ llm: failing, realCases: REAL.slice(0, 3) });
    const s = await runLayerC(cfg());
    expect(s.total).toBe(0);
    expect(s.agreement).toEqual({ point: 0, low: 0, high: 1, n: 0, confidence: 0.95 });
    expect(lastLayerCRun()!.errors.map((e) => e.caseId)).toEqual(['real:B1', 'real:B2', 'real:B3']);
    expect(readdirSync(join(dir, 'cache')).filter((f) => f.endsWith('.json'))).toHaveLength(0);

    const ok = createFakeLlm({ overrides: { 'second-opinion': answer('DOES_NOT_FIT') } });
    configureLayerC({ llm: ok, realCases: REAL.slice(0, 3) });
    const again = await runLayerC(cfg());
    expect(again.total).toBe(3);
    expect(again.agreed).toBe(2); // B2, B3
  });

  it('runs at most `concurrency` model calls at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const fake = createFakeLlm({ overrides: { 'second-opinion': answer('FIT') } });
    const slow: LlmProvider = {
      name: 'slow-fake',
      configured: true,
      async generateJson<T>(request: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>> {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        try {
          return await fake.generateJson(request);
        } finally {
          inFlight -= 1;
        }
      },
    };
    configureLayerC({ llm: slow, realCases: REAL });
    await runLayerC(cfg({ concurrency: 2 }));
    expect(peak).toBe(2);
    await runLayerC(cfg({ concurrency: 1, resume: false }));
    expect(peak).toBe(2);
    inFlight = 0;
    peak = 0;
    await runLayerC(cfg({ concurrency: 1, resume: false }));
    expect(peak).toBe(1);
  });

  it('adds the stratified generated cases after the real ones, grouped by stratum', async () => {
    const llm = createFakeLlm({ overrides: { 'second-opinion': answer('REFER', 'building_age') } });
    configureLayerC({ llm, realCases: REAL.slice(0, 2) });
    const s = await runLayerC(cfg({ generatedCount: 40, seed: 11 }));
    const sample = stratifiedSample(11, 40);
    expect(s.total).toBe(2 + sample.length);
    const engineRefers = sample.filter((c) => engineViewForInput(c.case.input).verdict === 'REFER').length;
    expect(s.agreed).toBe(engineRefers); // B1 and B2 are FIT / DOES_NOT_FIT
    expect(s.byStratum[0]).toEqual({ stratum: REAL_STRATUM, total: 2, agreed: 0 });
    expect(s.byStratum.reduce((n, r) => n + r.total, 0)).toBe(s.total);
    const detail = lastLayerCRun()!;
    expect(detail.generatedCases).toBe(sample.length);
    expect(detail.results[0]!.caseId).toBe('real:B1');
  });

  it('judgeOne refuses a case runLayerC never registered', async () => {
    configureLayerC({ llm: createFakeLlm() });
    await expect(judgeOne('nope', 'facts')).rejects.toThrow(/not registered/);
  });
});

describe('verify:llm CLI', () => {
  it('writes VERIFICATION.md and summary.json from real inputs and a run summary', async () => {
    const out = join(dir, 'out');
    const report = join(dir, 'VERIFICATION.md');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'real-inputs.json'), JSON.stringify(REAL));
    writeFileSync(
      join(out, 'run-summary.json'),
      JSON.stringify({
        startedAt: '2026-09-19T00:00:00.000Z',
        finishedAt: '2026-09-19T01:00:00.000Z',
        config: { total: 100, seed: 1, workers: 1, chunkSize: 100, maxDisagreements: 0, outDir: out },
        completed: 100,
        invariantViolations: 0,
        disagreements: 0,
        errors: 0,
        casesPerSecond: 50,
        firstViolations: [],
        firstDisagreements: [],
      }),
    );
    const lines: string[] = [];
    const llm = createFakeLlm({ overrides: { 'second-opinion': answer('DOES_NOT_FIT', 'tiv') } });
    setCliLlmDeps({ llm, log: (l) => lines.push(l), now: () => '2026-09-19T02:00:00.000Z' });

    const code = await main(['--generated', '0', '--out-dir', out, '--report', report]);
    expect(code).toBe(0);

    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    expect(summary.llmCasesRun).toBe(12);
    // B2, B3, B4, B5, B7, B12 are DOES_NOT_FIT.
    expect(summary.llmAgreementRate).toBeCloseTo(6 / 12, 12);
    expect(summary.llmAgreementCi95).toEqual([wilsonInterval(6, 12).low, wilsonInterval(6, 12).high]);
    expect(summary.propertyCasesRun).toBe(100);
    expect(summary.layerCRealCases).toBe(12);
    expect(typeof summary.extractionFieldAccuracy).toBe('number');

    const md = readFileSync(report, 'utf8');
    expect(md).toContain('| C. LLM second opinion | 12 | 6 agreed');
    expect(md).toContain('#### real:B1');
    expect(md).toContain('## Extraction check');
    expect(llm.callsFor('extract-reply').length).toBeGreaterThan(0);
  });

  it('fails with exit 2 when the provider is not configured, and on a bad flag', async () => {
    const lines: string[] = [];
    const unconfigured: LlmProvider = { ...createFakeLlm(), name: 'gemini', configured: false };
    setCliLlmDeps({ llm: unconfigured, log: (l) => lines.push(l) });
    expect(await main(['--out-dir', join(dir, 'out')])).toBe(2);
    expect(lines.join('\n')).toMatch(/ANTHROPIC_API_KEY is not set/);
    expect(await main(['--bogus'])).toBe(2);
    expect(await main(['--concurrency', '0'])).toBe(2);
  });

  it('exits 1 when some cases went unanswered', async () => {
    const out = join(dir, 'out');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'real-inputs.json'), JSON.stringify(REAL.slice(0, 2)));
    setCliLlmDeps({ llm: createFakeLlm({ failFor: ['second-opinion'] }), log: () => undefined, now: () => 'x' });
    const code = await main(['--generated', '0', '--out-dir', out, '--report', join(dir, 'V.md'), '--no-extraction']);
    expect(code).toBe(1);
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    expect(summary.layerCUnanswered).toBe(2);
    expect(summary.llmCasesRun).toBe(0);
  });
});
