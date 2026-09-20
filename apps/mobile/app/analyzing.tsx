import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { SweepDto, SweepStageDto } from '@retrofit/contracts';

import { describeApiError, getApi, isApiError, pollSweep } from '@/lib/api';
import { sessionStore, useSession } from '@/lib/session';
import { Button, COLORS, Card, Icon, Notice, RADIUS, Screen, SPACE, Skeleton, Text } from '@/ui';
import type { IconName } from '@/ui';

/**
 * Reading the room. Driven only by the real `stage` the API returns from
 * GET /sweeps/:id, polled every 1.2 s. Nothing here is a timer pretending to be
 * progress.
 *
 * There is never a bare spinner: each finding gets its own card the moment its
 * observation resolves. The API returns them in one batch, so the cards are
 * staggered client-side at 120 ms to read as arriving rather than appearing.
 *
 * At rest the only destination is the verdict. A short sweep no longer stops
 * here to ask for a rescan; the verdict carries that note, so Finish stays the
 * one tap between launch and a price.
 */

/** Pipeline order of the working stages. */
const ORDER: readonly SweepStageDto[] = ['received', 'quality_gate', 'observing', 'relating', 'scoring'];

/** One card per 120 ms, so findings read as arriving. */
const STAGGER_MS = 120;

const STEPS: readonly { readonly doing: string; readonly done: string }[] = [
  { doing: 'Receiving photos', done: 'Photos received' },
  { doing: 'Checking sharpness', done: 'Photos checked' },
  { doing: 'Reading the room', done: 'Room read' },
  { doing: 'Checking risks', done: 'Risks checked' },
  { doing: 'Pricing', done: 'Priced' },
];

/** Plain names for the object vocabulary, and an icon that only decorates. */
const LABEL_WORDS: Readonly<Record<string, { readonly name: string; readonly icon: IconName }>> = {
  portable_heater: { name: 'Space heater', icon: 'flame-outline' },
  extension_cord: { name: 'Extension cord', icon: 'flash-outline' },
  power_bar: { name: 'Power bar', icon: 'flash-outline' },
  outlet: { name: 'Outlet', icon: 'flash-outline' },
  curtain: { name: 'Curtains', icon: 'browsers-outline' },
  fabric: { name: 'Fabric', icon: 'browsers-outline' },
  bedding: { name: 'Bedding', icon: 'bed-outline' },
  smoke_detector: { name: 'Smoke detector', icon: 'radio-button-on-outline' },
  sprinkler_head: { name: 'Sprinkler head', icon: 'water-outline' },
  window_ac_unit: { name: 'Window AC', icon: 'snow-outline' },
  stove: { name: 'Stove', icon: 'restaurant-outline' },
  candle: { name: 'Candle', icon: 'flame-outline' },
  bike: { name: 'Bike', icon: 'bicycle-outline' },
  jewelry: { name: 'Jewellery', icon: 'diamond-outline' },
  camera: { name: 'Camera', icon: 'camera-outline' },
  laptop: { name: 'Laptop', icon: 'laptop-outline' },
  tv: { name: 'TV', icon: 'tv-outline' },
  instrument: { name: 'Instrument', icon: 'musical-notes-outline' },
  blocked_exit: { name: 'Blocked exit', icon: 'exit-outline' },
  water_heater: { name: 'Water heater', icon: 'water-outline' },
  unknown: { name: 'Item', icon: 'ellipse-outline' },
};

/** How many steps the server has finished, from its `stage` alone. */
function finishedSteps(stage: SweepStageDto | null): number {
  if (stage === null) return 0;
  if (stage === 'questions' || stage === 'done') return STEPS.length;
  const i = ORDER.indexOf(stage);
  return i < 0 ? 0 : i + 1;
}

/** Server errors for `failed` start with a stage name when they are technical. */
function plainFailure(error: string | null): string {
  if (error && !/^[a-z_]+: /.test(error)) return error;
  return 'The photos could not be read. Scan the room again.';
}

/** A bearing relative to the sweep start, as a direction a person can act on. */
function where(bearingDeg: number): string {
  if (!Number.isFinite(bearingDeg)) return 'in the room';
  const d = ((Math.round(bearingDeg) % 360) + 360) % 360;
  if (d < 30 || d >= 330) return 'ahead';
  if (d < 150) return 'right';
  if (d < 210) return 'behind';
  return 'left';
}

interface Finding {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  readonly where: string;
}

/** One card per kind of thing seen, strongest sighting first. */
function findingsOf(sweep: SweepDto | null): Finding[] {
  if (sweep === null) return [];
  const best = new Map<string, SweepDto['observations'][number]>();
  for (const o of sweep.observations) {
    if (o.derived === true || o.label === 'unknown') continue;
    const prior = best.get(o.label);
    if (prior === undefined || o.confidence > prior.confidence) best.set(o.label, o);
  }
  return [...best.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .map((o) => {
      const words = LABEL_WORDS[o.label] ?? LABEL_WORDS.unknown!;
      return { id: o.label, name: words.name, icon: words.icon, where: where(o.bearingDeg) };
    });
}

type Load =
  | { readonly kind: 'polling' }
  | { readonly kind: 'slow' }
  | { readonly kind: 'error'; readonly message: string };

export default function AnalyzingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const sessionSweepId = useSession((s) => s.sweepId);
  const sweepId = (typeof params.id === 'string' && params.id.length > 0 ? params.id : sessionSweepId) ?? null;

  const [sweep, setSweep] = useState<SweepDto | null>(null);
  const [load, setLoad] = useState<Load>({ kind: 'polling' });
  const [attempt, setAttempt] = useState(0);
  const moved = useRef(false);

  const goOn = useCallback(
    (s: SweepDto) => {
      if (moved.current) return;
      moved.current = true;
      AccessibilityInfo.announceForAccessibility('Quote ready.');
      router.replace({ pathname: '/verdict', params: { id: s.id } });
    },
    [router],
  );

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
        // `questions` means one optional question, which the verdict carries.
        if (s.stage !== 'failed') goOn(s);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiError(error) && error.kind === 'aborted') return;
        if (isApiError(error) && error.kind === 'timeout') setLoad({ kind: 'slow' });
        else setLoad({ kind: 'error', message: describeApiError(error) });
      });
    return () => controller.abort();
  }, [sweepId, attempt, goOn]);

  const finished = finishedSteps(sweep?.stage ?? null);
  const failed = sweep?.stage === 'failed';
  const findings = useMemo(() => findingsOf(sweep), [sweep]);
  const shown = useStaggered(findings.length, failed ? 0 : STAGGER_MS);

  // Announce each step as the server finishes it, not on every poll.
  const lastSaid = useRef(0);
  useEffect(() => {
    if (finished > lastSaid.current && finished > 0 && finished <= STEPS.length) {
      const step = STEPS[finished - 1];
      if (step) AccessibilityInfo.announceForAccessibility(step.done);
    }
    lastSaid.current = Math.max(lastSaid.current, finished);
  }, [finished]);

  function scanAgain(): void {
    sessionStore.clearFrames();
    sessionStore.setSweepId(null);
    router.replace('/');
  }

  if (sweepId === null) {
    return (
      <Screen title="No scan">
        <Notice tone="error">There is no scan to read.</Notice>
        <Button label="Scan a room" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const current = STEPS[Math.min(finished, STEPS.length - 1)];
  const kept = sweep ? sweep.frames.filter((f) => !f.dropped).length : 0;

  return (
    <Screen
      title={failed ? 'Not read' : (current?.doing ?? 'Reading the room')}
      subtitle={
        failed
          ? undefined
          : sweep
            ? `${kept} of ${sweep.frames.length} photos · ${String(Math.round(sweep.coverage?.coveragePct ?? 0))}% of the room`
            : undefined
      }
      footer={
        failed ? (
          <>
            <Button label="Scan again" onPress={scanAgain} />
            <Button label="Upload 3 photos instead" variant="secondary" onPress={scanAgain} />
          </>
        ) : undefined
      }
    >
      <StepBar finished={finished} failed={failed} />

      {failed ? <Notice tone="error">{plainFailure(sweep?.error ?? null)}</Notice> : null}

      {load.kind === 'slow' ? (
        <Notice tone="info" actionLabel="Keep waiting" onAction={() => setAttempt((n) => n + 1)}>
          Slower than usual.
        </Notice>
      ) : null}

      {load.kind === 'error' ? (
        <Notice tone="error" actionLabel="Try again" onAction={() => setAttempt((n) => n + 1)}>
          {load.message}
        </Notice>
      ) : null}

      {/* Findings, one card each, as they resolve. Never a bare spinner. */}
      <View accessibilityRole="list" style={{ gap: SPACE.sm }}>
        {findings.slice(0, shown).map((f) => (
          <FindingCard key={f.id} finding={f} />
        ))}
        {!failed && shown < Math.max(findings.length, 1) ? <PendingCard /> : null}
      </View>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/** Reveals `count` items one every `everyMs`, and never un-reveals. */
function useStaggered(count: number, everyMs: number): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= count) return undefined;
    if (everyMs <= 0) {
      setShown(count);
      return undefined;
    }
    const t = setTimeout(() => setShown((n) => Math.min(count, n + 1)), everyMs);
    return () => clearTimeout(t);
  }, [shown, count, everyMs]);
  return shown;
}

/** Five segments, filled as the server finishes each stage. Not a spinner. */
function StepBar({ finished, failed }: { readonly finished: number; readonly failed: boolean }) {
  const done = STEPS[finished - 1]?.done ?? 'Starting';
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: STEPS.length, now: finished, text: done }}
      style={{ gap: SPACE.sm }}
    >
      <View style={{ flexDirection: 'row', gap: SPACE.xs }}>
        {STEPS.map((step, i) => (
          <View
            key={step.done}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i < finished ? COLORS.ink : COLORS.mutedTint,
            }}
          />
        ))}
      </View>
      <Text variant="small" tone="muted">
        {failed ? 'Stopped' : done}
      </Text>
    </View>
  );
}

function FindingCard({ finding }: { readonly finding: Finding }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(enter, { toValue: 1, duration: 180, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [enter]);
  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
    >
      <Card padding="md" accessibilityLabel={`${finding.name}, ${finding.where}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: RADIUS.pill,
              backgroundColor: COLORS.mutedTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={finding.icon} size={16} color={COLORS.mutedDeep} />
          </View>
          <Text weight="semibold" style={{ flex: 1 }}>
            {finding.name}
          </Text>
          <Text variant="small" tone="muted">
            {finding.where}
          </Text>
        </View>
      </Card>
    </Animated.View>
  );
}

/** The next card's outline, so the list is never empty and never a spinner. */
function PendingCard() {
  return (
    <Card padding="md" tone="muted">
      <Skeleton lines={1} variant="body" accessibilityLabel="Looking" />
    </Card>
  );
}
