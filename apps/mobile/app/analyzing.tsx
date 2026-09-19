import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { SweepDto, SweepStageDto } from '@retrofit/contracts';

import { describeApiError, getApi, isApiError, pollSweep } from '@/lib/api';
import { sessionStore, useSession } from '@/lib/session';
import { Button, Card, COLORS, Icon, Notice, RADIUS, Screen, SPACE, Text } from '@/ui';
import type { IconName } from '@/ui';

/**
 * Working it out — PRD §11 `/analyzing`. Unit M6.
 *
 * Staged loaders driven ONLY by the real `stage` the API returns from
 * GET /sweeps/:id (M1's `pollSweep`, every 1.2 s). There is no timer that
 * pretends progress: a step turns "done" when the server's stage says so.
 *
 * The server's `stage` names the last step it FINISHED (apps/api
 * services/sweep.ts): `received` -> quality gate -> `quality_gate` -> observe ->
 * `observing` -> relate -> `relating` -> score -> `scoring` -> `questions` | `done`.
 *
 * At rest:
 *   - `questions` -> /confirm (which moves straight on to /questions when there
 *     is nothing to confirm);
 *   - `done` -> /verdict;
 *   - `failed` -> the server's reason in plain words, with "Scan again" and
 *     "Use photos instead";
 *   - server coverage below its own threshold -> we name the missed part of
 *     the room and offer a re-scan before going on (PRD §9.3).
 *
 * Every figure shown (photos kept, coverage, items found) is read from the
 * API's reply. Nothing here computes a verdict, a price or a hazard.
 */

/** Pipeline order of the working stages. */
const ORDER: readonly SweepStageDto[] = ['received', 'quality_gate', 'observing', 'relating', 'scoring'];

interface Step {
  /** Plain words while the step runs. */
  readonly doing: string;
  /** Plain words once it is done. */
  readonly done: string;
  /** Decorative only — the words above always carry the meaning. */
  readonly icon: IconName;
}

/** Step i is finished when the server's stage has reached ORDER[i]. */
const STEPS: readonly Step[] = [
  { doing: 'Receiving your photos', done: 'Photos received', icon: 'cloud-upload-outline' },
  { doing: 'Checking each photo is clear enough', done: 'Photos checked', icon: 'checkmark-done-outline' },
  { doing: 'Looking at what is in the room', done: 'Items in the room found', icon: 'eye-outline' },
  { doing: 'Checking for risks, like a heater near curtains', done: 'Risks checked', icon: 'shield-checkmark-outline' },
  { doing: 'Working out your quote', done: 'Quote worked out', icon: 'calculator-outline' },
];

type StepStatus = 'done' | 'now' | 'waiting';

/** How many steps the server has finished, from its `stage` alone. */
function finishedSteps(stage: SweepStageDto | null): number {
  if (stage === null) return 0;
  if (stage === 'questions' || stage === 'done') return STEPS.length;
  const i = ORDER.indexOf(stage);
  return i < 0 ? 0 : i + 1;
}

/** Server errors for `failed` start with a stage name when they are technical ("observing: …"). */
function plainFailure(error: string | null): string {
  if (error && !/^[a-z_]+: /.test(error)) return error;
  return 'Something went wrong while we looked at your photos. Please scan the room again.';
}

/** A bearing relative to the sweep start, as words a person can act on. */
function whereInRoom(centerDeg: number): string {
  const d = ((Math.round(centerDeg) % 360) + 360) % 360;
  if (d <= 20 || d >= 340) return 'straight ahead of where you started';
  if (d >= 160 && d <= 200) return 'behind where you started';
  return d < 180
    ? `about ${Math.round(d / 10) * 10} degrees to the right of where you started`
    : `about ${Math.round((360 - d) / 10) * 10} degrees to the left of where you started`;
}

type Load =
  | { readonly kind: 'polling' }
  | { readonly kind: 'slow' }
  | { readonly kind: 'error'; readonly message: string };

export default function AnalyzingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const sessionSweepId = useSession((s) => s.sweepId);
  // Only a camera sweep is asked to re-scan a missed arc. Three uploaded
  // photos rarely cover 75% of a room, and the photo path must never loop.
  const fromSweep = useSession((s) => s.source === 'sweep');
  const sweepId = (typeof params.id === 'string' && params.id.length > 0 ? params.id : sessionSweepId) ?? null;

  const [sweep, setSweep] = useState<SweepDto | null>(null);
  const [load, setLoad] = useState<Load>({ kind: 'polling' });
  const [attempt, setAttempt] = useState(0);
  const moved = useRef(false);

  const goOn = useCallback(
    (s: SweepDto) => {
      if (moved.current) return;
      moved.current = true;
      if (s.stage === 'done') {
        AccessibilityInfo.announceForAccessibility('Done. Showing your quote.');
        router.replace({ pathname: '/verdict', params: { id: s.id } });
      } else {
        AccessibilityInfo.announceForAccessibility('Done. Showing what we found.');
        router.replace({ pathname: '/confirm', params: { id: s.id } });
      }
    },
    [router],
  );

  // Poll the real stage. Restarted by "Keep waiting" / "Try again" (attempt).
  useEffect(() => {
    if (sweepId === null) return undefined;
    const controller = new AbortController();
    setLoad({ kind: 'polling' });
    pollSweep(getApi(), sweepId, {
      signal: controller.signal,
      onUpdate: (s) => {
        if (!controller.signal.aborted) setSweep(s);
      },
    })
      .then((s) => {
        if (controller.signal.aborted) return;
        setSweep(s);
        const coverageShort =
          fromSweep && s.coverage !== null && !s.coverage.sufficient && s.coverage.largestGap !== null;
        if (s.stage !== 'failed' && !coverageShort) goOn(s);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiError(error) && error.kind === 'aborted') return;
        if (isApiError(error) && error.kind === 'timeout') setLoad({ kind: 'slow' });
        else setLoad({ kind: 'error', message: describeApiError(error) });
      });
    return () => controller.abort();
  }, [sweepId, attempt, goOn, fromSweep]);

  // Announce each step as the server finishes it (not on every poll).
  const finished = finishedSteps(sweep?.stage ?? null);
  const lastSaid = useRef(0);
  useEffect(() => {
    if (finished > lastSaid.current && finished > 0 && finished <= STEPS.length) {
      const step = STEPS[finished - 1];
      const next = STEPS[finished];
      if (step) AccessibilityInfo.announceForAccessibility(`${step.done}.${next ? ` Now: ${next.doing.toLowerCase()}.` : ''}`);
    }
    lastSaid.current = Math.max(lastSaid.current, finished);
  }, [finished]);

  function scanAgain(): void {
    sessionStore.clearFrames();
    sessionStore.setSweepId(null);
    router.replace('/sweep');
  }

  if (sweepId === null) {
    return (
      <Screen title="No scan to work on">
        <Notice tone="error">We could not find a scan to look at. Please start a new room.</Notice>
        <Button label="Start a new room" onPress={() => router.replace('/new')} />
      </Screen>
    );
  }

  const failed = sweep?.stage === 'failed';
  const atRest = sweep !== null && (sweep.stage === 'questions' || sweep.stage === 'done');
  const coverage = sweep?.coverage ?? null;
  const gap = fromSweep && coverage !== null && !coverage.sufficient ? coverage.largestGap : null;
  const gapCenter = gap ? gap.startDeg + gap.widthDeg / 2 : null;

  return (
    <Screen
      title="Working it out"
      subtitle="This usually takes under a minute. You can keep the phone in your pocket."
      footer={
        failed ? (
          <>
            <Button label="Scan the room again" onPress={scanAgain} />
            <Button
              label="Use 3 photos instead"
              variant="secondary"
              accessibilityHint="Goes back to pick three photos of the room from your library."
              onPress={() => router.replace('/new')}
            />
          </>
        ) : atRest && gap ? (
          <>
            <Button label="Scan the room again" onPress={scanAgain} />
            <Button
              label="Continue anyway"
              variant="secondary"
              accessibilityHint="Goes on with the photos you have. Some answers may be less certain."
              onPress={() => sweep && goOn(sweep)}
            />
          </>
        ) : undefined
      }
    >
      <View accessibilityRole="list" style={{ gap: SPACE.sm }}>
        {STEPS.map((step, i) => {
          const status: StepStatus = i < finished ? 'done' : i === finished && !failed ? 'now' : 'waiting';
          return <StepRow key={step.done} step={step} index={i} status={status} />;
        })}
      </View>

      {sweep ? <Facts sweep={sweep} finished={finished} /> : null}

      {failed ? <Notice tone="error">{plainFailure(sweep?.error ?? null)}</Notice> : null}

      {atRest && gap && gapCenter !== null ? (
        <Notice tone="info">
          {`Part of the room did not come out clearly: the part ${whereInRoom(gapCenter)}. A quick re-scan gives a better answer. You can also go on with what we have.`}
        </Notice>
      ) : null}

      {load.kind === 'slow' ? (
        <Notice tone="info" actionLabel="Keep waiting" onAction={() => setAttempt((n) => n + 1)}>
          This is taking longer than usual.
        </Notice>
      ) : null}

      {load.kind === 'error' ? (
        <Notice tone="error" actionLabel="Try again" onAction={() => setAttempt((n) => n + 1)}>
          {load.message}
        </Notice>
      ) : null}
    </Screen>
  );
}

function StepRow({ step, index, status }: { readonly step: Step; readonly index: number; readonly status: StepStatus }) {
  const words = status === 'done' ? step.done : step.doing;
  const state = status === 'done' ? 'done' : status === 'now' ? 'in progress' : 'waiting';
  return (
    <View
      accessible
      accessibilityLabel={`Step ${index + 1} of ${STEPS.length}: ${words}, ${state}`}
      accessibilityState={{ busy: status === 'now' }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE.md,
        minHeight: 44,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.sm,
        borderRadius: RADIUS.card,
        borderWidth: status === 'now' ? 2 : 1,
        borderColor: status === 'now' ? COLORS.ink : COLORS.mutedTint,
        backgroundColor: status === 'done' ? COLORS.mutedTint : COLORS.paper,
      }}
    >
      {/* A shape for each state, so the state never rests on colour alone. */}
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: status === 'done' ? COLORS.ink : status === 'now' ? COLORS.blueTint : 'transparent',
        }}
      >
        {status === 'now' ? (
          <ActivityIndicator color={COLORS.blueDeep} />
        ) : status === 'done' ? (
          <Icon name="checkmark" size={18} color={COLORS.paper} />
        ) : (
          <Icon name={step.icon} size={16} color={COLORS.mutedDeep} />
        )}
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text weight={status === 'now' ? 'semibold' : 'regular'} tone={status === 'waiting' ? 'muted' : 'ink'}>
          {words}
        </Text>
        <Text variant="small" tone="muted">
          {status === 'done' ? 'Done' : status === 'now' ? 'In progress' : 'Waiting'}
        </Text>
      </View>
    </View>
  );
}

/** Numbers straight from the API's sweep, shown once the step that makes them is done. */
function Facts({ sweep, finished }: { readonly sweep: SweepDto; readonly finished: number }) {
  const lines: string[] = [];
  if (finished >= 2 && sweep.frames.length > 0) {
    const kept = sweep.frames.filter((f) => !f.dropped).length;
    lines.push(`${kept} of ${sweep.frames.length} photos were clear enough to use.`);
  }
  if (finished >= 2 && sweep.coverage) {
    lines.push(`About ${Math.round(sweep.coverage.coveragePct)}% of the room is covered by those photos.`);
  }
  if (finished >= 3) {
    const n = sweep.observations.length;
    lines.push(n === 1 ? 'We found 1 item.' : `We found ${n} items.`);
  }
  if (lines.length === 0) return null;
  return (
    <Card tone="plain">
      {lines.map((l) => (
        <Text key={l}>{l}</Text>
      ))}
    </Card>
  );
}
