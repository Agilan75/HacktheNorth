/** One new photo of a fixed hazard: re-run and return the new price. Unit A18. */
import type { VerifyFixRequestDto, VerifyFixResponseDto } from '@retrofit/contracts';
import type { EngineResult, Observation } from '@retrofit/engine';
import { createRepos } from '../db/repos';
import { imageMetrics } from '../images/metrics';
import { gradeFrame } from '../images/quality';
import { verifyFixCall } from '../llm/index';
import {
  decodeBase64Image,
  hazardKeyOf,
  loadTenantConfig,
  normalizeImage,
  scoreSweep,
  sessionOf,
  snapshotOfResult,
} from './sweep';
import type { FixEvent, SessionEvent } from './sweep';
import type { Deps } from './types';

const LABEL_TEXT = (label: string): string => label.replace(/_/g, ' ');

/** What the sweep saw that made the hazard: the sightings behind the value the engine used. */
function whatWasSeen(result: EngineResult, observations: readonly Observation[], key: string, fallback: string): string {
  const fields = result.canonical.hazards.present[key as keyof typeof result.canonical.hazards.present] ?? [];
  const ids = new Set<string>();
  for (const f of fields) {
    if (f.value !== true) continue;
    const detail = f.provenance.sourceDetail ?? '';
    const m = /^(?:observation|observations|pair|relate):(.+)$/.exec(detail);
    if (m !== null) for (const id of m[1]!.split('+')) ids.add(id);
  }
  const seen = observations
    .filter((o) => ids.has(o.id))
    .map((o) => (o.notes !== undefined && o.notes.length > 0 ? `${LABEL_TEXT(o.label)} (${o.notes})` : LABEL_TEXT(o.label)));
  if (seen.length > 0) return seen.join('; ');
  return fields.some((f) => f.value === true) ? `${fallback}, as reported` : `${fallback}, not directly seen`;
}

export async function verifyFix(
  deps: Deps,
  sweepId: string,
  request: VerifyFixRequestDto,
): Promise<VerifyFixResponseDto> {
  const repos = createRepos(deps.db);
  const row = repos.sweeps.byId(sweepId);
  if (row === null) throw new Error(`no sweep "${sweepId}"`);
  const before = row.result ?? null;
  if (before === null) throw new Error(`sweep "${sweepId}" has no verdict yet to re-check`);

  const { config } = await loadTenantConfig();
  const hazardKey = hazardKeyOf(request.hazardKey);
  const component = config.spec.components.find(
    (c) => c.source === `hazards.${hazardKey}` && c.type === 'binary',
  );
  if (component === undefined) throw new Error(`"${request.hazardKey}" is not a hazard a photo can clear`);

  // The code-side quality gate runs before the model, as for the sweep (PRD 9.3 step 1).
  let check: { stillPresent: boolean; confidence: number; reason: string };
  let photo: string | null = null;
  try {
    const bytes = decodeBase64Image(request.imageBase64);
    const grade = gradeFrame(await imageMetrics(bytes));
    if (grade.pass) photo = await normalizeImage(bytes);
    else
      check = {
        stillPresent: true,
        confidence: 0,
        reason: `The photo was too ${grade.reason === 'blur' ? 'blurry' : (grade.reason ?? 'poor').replace(/_/g, ' ')} to check, so the hazard is still counted.`,
      };
  } catch {
    check = { stillPresent: true, confidence: 0, reason: 'The photo could not be read, so the hazard is still counted.' };
  }

  if (photo !== null) {
    check = await verifyFixCall(
      deps.llm,
      {
        hazardKey,
        hazardLabel: component.label,
        whatWasSeen: whatWasSeen(before, row.observations, hazardKey, component.label),
        roomLabel: row.roomLabel,
      },
      { kind: 'image', mimeType: 'image/jpeg', dataBase64: photo, label: `after-fix photo, ${request.capturedAt}` },
    );
  }

  const outcome = check!;
  const fix: FixEvent = {
    kind: 'fix',
    hazardKey,
    stillPresent: outcome.stillPresent,
    confidence: outcome.confidence,
    reason: outcome.reason,
    capturedAt: request.capturedAt,
    at: deps.clock.nowIso(),
  };
  const events: SessionEvent[] = [...sessionOf(before), fix];
  const { result, stage } = await scoreSweep(deps, row, events);
  repos.sweeps.update(sweepId, { result, stage, error: null, updatedAt: deps.clock.nowIso() });

  return {
    sweepId,
    hazardKey,
    stillPresent: outcome.stillPresent,
    confidence: outcome.confidence,
    reason: outcome.reason,
    before: snapshotOfResult(before),
    after: snapshotOfResult(result),
    result,
  };
}
