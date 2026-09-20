import { formatMoney, formatPercent, pluralize } from '@retrofit/contracts';
import type {
  Disagreement,
  InvariantViolation,
  LayerCCaseResult,
  LayerCSummary,
  RunSummary,
} from './types.js';

/**
 * VERIFICATION.md writer (V07). Reports the count actually completed, the
 * agreement rate with its 95% interval, and every layer-C disagreement with
 * both sides' reasoning.
 *
 * Pure: every timestamp comes from the summaries, so the same inputs always
 * render the same bytes.
 */
export function renderReport(run: RunSummary, layerC: LayerCSummary | null): string {
  const out: string[] = [];
  out.push('# Verification', '');
  out.push(
    `Generated ${run.finishedAt} (run started ${run.startedAt}). PRD §12. ` +
      'Every count below is the number of cases actually completed, not the number requested.',
    '',
  );

  out.push('## Headline', '');
  out.push('| Layer | Cases completed | Result |', '| --- | --- | --- |');
  out.push(
    `| A. Property tests | ${int(run.completed)} | ${int(run.invariantViolations)} invariant ${plural(run.invariantViolations, 'violation')} |`,
  );
  out.push(
    `| B. Differential (naive second implementation) | ${int(run.completed)} | ${int(run.disagreements)} ${plural(run.disagreements, 'disagreement')} |`,
  );
  if (layerC) {
    out.push(
      `| C. LLM second opinion | ${int(layerC.total)} | ${int(layerC.agreed)} agreed, ${agreementText(layerC)} |`,
    );
  } else {
    out.push('| C. LLM second opinion | 0 | not run |');
  }
  out.push('');

  out.push('## Layers A and B', '');
  const c = run.config;
  out.push(
    `- Requested: ${int(c.total)} cases, seed ${c.seed}, ${c.workers} ${plural(c.workers, 'worker')}, chunk size ${int(c.chunkSize)}.`,
  );
  out.push(`- Completed: ${int(run.completed)} cases${completionNote(run)}.`);
  out.push(`- Throughput: ${int(Math.round(run.casesPerSecond))} cases per second.`);
  out.push(`- Invariant violations: ${int(run.invariantViolations)}.`);
  out.push(`- Engine-versus-naive disagreements: ${int(run.disagreements)}.`);
  out.push(`- Cases that threw: ${int(run.errors)}.`);
  out.push('');

  if (run.firstViolations.length > 0) {
    out.push(
      `### Invariant violations (first ${run.firstViolations.length} of ${int(run.invariantViolations)})`,
      '',
    );
    out.push('| Invariant | Case | Seed | Message | Observed | Expected |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const v of run.firstViolations) out.push(violationRow(v));
    out.push('');
  }

  if (run.firstDisagreements.length > 0) {
    out.push(
      `### Differential disagreements (first ${run.firstDisagreements.length} of ${int(run.disagreements)})`,
      '',
    );
    for (const d of run.firstDisagreements) out.push(...disagreementBlock(d));
  }

  out.push('## Layer C: LLM second opinion', '');
  if (!layerC) {
    out.push('Layer C has not been run. Run `npm run verify:llm`.', '');
  } else {
    out.push(...layerCSection(layerC));
  }

  out.push('## Caveats', '');
  out.push(
    '- Layer C is capped: agreement stops moving after a few thousand stratified cases, and ten million model calls would cost thousands of dollars.',
    '- The model is the less reliable party. A layer-C disagreement is a lead, not proof the engine is wrong.',
    '- The app also uses Gemini, so layer C is a weaker independent check than a second vendor would be. Layer B is the real correctness check.',
    '- The model sees only the guideline text and the rolled-up facts. It never sees engine output.',
    '',
  );
  return out.join('\n');
}

/** The machine-readable summary the API's /aggregate route reads. */
export function renderSummaryJson(
  run: RunSummary,
  layerC: LayerCSummary | null,
): Readonly<Record<string, unknown>> {
  return {
    // The AggregateDto.verification fields, so the route can pass them through.
    propertyCasesRun: run.completed,
    differentialCasesRun: run.completed,
    disagreements: run.disagreements,
    llmCasesRun: layerC ? layerC.total : 0,
    llmAgreementRate: layerC && layerC.total > 0 ? layerC.agreement.point : null,
    llmAgreementCi95:
      layerC && layerC.total > 0 ? [layerC.agreement.low, layerC.agreement.high] : null,
    extractionFieldAccuracy: null,
    generatedAt: run.finishedAt,
    // Detail beyond the DTO.
    startedAt: run.startedAt,
    requested: run.config.total,
    seed: run.config.seed,
    invariantViolations: run.invariantViolations,
    errors: run.errors,
    casesPerSecond: run.casesPerSecond,
    layerC: layerC
      ? {
          total: layerC.total,
          agreed: layerC.agreed,
          agreement: layerC.agreement,
          byStratum: layerC.byStratum,
          disagreementCaseIds: layerC.disagreements.map((d) => d.caseId),
        }
      : null,
  };
}

/* ------------------------------------------------------------ private */

function layerCSection(s: LayerCSummary): string[] {
  const out: string[] = [];
  out.push(`- Cases judged: ${int(s.total)}.`);
  out.push(`- Agreed with the engine: ${int(s.agreed)}.`);
  out.push(`- Agreement rate: ${agreementText(s)}.`);
  out.push(`- Disagreements: ${int(s.disagreements.length)}.`, '');

  if (s.byStratum.length > 0) {
    out.push('| Stratum | Cases | Agreed | Rate |', '| --- | --- | --- | --- |');
    for (const row of s.byStratum) {
      out.push(
        `| ${cell(row.stratum)} | ${int(row.total)} | ${int(row.agreed)} | ${row.total > 0 ? pct(row.agreed / row.total) : '—'} |`,
      );
    }
    out.push('');
  }

  if (s.disagreements.length > 0) {
    out.push('### Every layer-C disagreement', '');
    for (const d of s.disagreements) out.push(...layerCDisagreement(d));
  }
  return out;
}

function layerCDisagreement(d: LayerCCaseResult): string[] {
  const e = d.engine;
  const knockouts = e.knockoutFactorIds.length > 0 ? e.knockoutFactorIds.join(', ') : 'none';
  const out = [
    `#### ${d.caseId} (stratum \`${d.stratum}\`)${d.cached ? ' — cached' : ''}`,
    '',
    `- **Engine:** ${e.verdict}, deciding factor \`${e.decidingFactorId ?? 'none'}\`. ` +
      `Appetite score ${fixed(e.appetiteScore, 1)}, completeness ${fixed(e.completeness, 1)}%, knockouts: ${knockouts}.`,
  ];
  const tiers = Object.entries(e.tierValuesByFactor);
  if (tiers.length > 0) {
    out.push(
      `  Tier values: ${tiers.map(([k, v]) => `${k} ${v === null ? 'missing' : String(v)}`).join(', ')}.`,
    );
  }
  out.push(
    `- **Model:** ${d.model.verdict}, deciding factor \`${d.model.decidingFactor}\`.`,
    '',
    ...quote(d.model.reasoning),
    '',
  );
  return out;
}

function disagreementBlock(d: Disagreement): string[] {
  const out = [`#### ${d.caseId} (seed ${d.seed})`, ''];
  out.push('| Field | Engine | Naive | Tolerance |', '| --- | --- | --- | --- |');
  for (const f of d.fields) {
    out.push(
      `| ${cell(f.field)} | ${cell(show(f.engine))} | ${cell(show(f.naive))} | ${f.tolerance === null ? 'exact' : String(f.tolerance)} |`,
    );
  }
  out.push('', `Input: \`${JSON.stringify(d.input)}\``, '');
  return out;
}

function violationRow(v: InvariantViolation): string {
  return `| ${cell(v.invariant)} | ${cell(v.caseId)} | ${v.seed} | ${cell(v.message)} | ${cell(show(v.observed))} | ${cell(show(v.expected))} |`;
}

function agreementText(s: LayerCSummary): string {
  if (s.total === 0) return 'no cases judged';
  const a = s.agreement;
  const level = Math.round(a.confidence * 100);
  return `${pct(a.point)} (${level}% Wilson interval ${pct(a.low)} – ${pct(a.high)}, n = ${int(a.n)})`;
}

function completionNote(run: RunSummary): string {
  const short = run.config.total - run.completed;
  return short > 0 ? ` (${int(short)} short of the ${int(run.config.total)} requested)` : '';
}

function quote(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return ['> (no reasoning given)'];
  return trimmed.split(/\r?\n/).map((line) => `> ${line}`);
}

function show(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  return JSON.stringify(v) ?? String(v);
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function int(n: number): string {
  return formatMoney(n, { symbol: false, decimals: 0 });
}

function pct(ratio: number): string {
  return formatPercent(ratio, { from: 'ratio', decimals: 1 });
}

function fixed(n: number, d: number): string {
  return Number.isFinite(n) ? n.toFixed(d) : String(n);
}

function plural(n: number, word: string): string {
  return pluralize(n, word, undefined, { includeCount: false });
}
