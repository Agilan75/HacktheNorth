import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { SweepDto } from '@retrofit/contracts';

import { describeApiError, getApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { BORDER } from '@retrofit/design';
import {
  Button,
  COLORS,
  Card,
  Heading,
  MIN_TOUCH_TARGET,
  Notice,
  RADIUS,
  SPACE,
  ScanRing,
  Screen,
  SkeletonCard,
  Text,
  bearingWords,
} from '@/ui';

/**
 * Check what we found — PRD §11 `/confirm`, PRD 9.3 step 7 (unit M7).
 *
 * The API returns `needsConfirmation`: the sightings it is not sure about
 * (under 0.6). They are drawn on the 2D radar ring at their bearing and listed
 * underneath, each with "Yes, it's there" / "No, it isn't". The person's
 * choices go back through POST /sweeps/:id/answers as `confirmations`; the API
 * re-scores. This screen never decides which items are uncertain, never
 * computes a confidence and never computes a verdict — it renders the list the
 * API sent (decision M7-1).
 *
 * Inclusivity: every item is named in words and placed in words ("90 degrees
 * to the right of where you started"), not only as a dot on the ring; the two
 * answer buttons carry a check mark and the words "You said: …" when chosen,
 * never colour alone; every target is at least 44pt and grows with text size.
 */

type Choice = 'confirmed' | 'dismissed';

/** Plain names for the engine's object labels (display only). */
const PLAIN_NAMES: Readonly<Record<string, string>> = {
  portable_heater: 'portable heater',
  extension_cord: 'extension cord',
  power_bar: 'power bar',
  outlet: 'wall outlet',
  curtain: 'curtains',
  fabric: 'fabric',
  bedding: 'bedding',
  smoke_detector: 'smoke detector',
  sprinkler_head: 'sprinkler',
  window_ac_unit: 'window air conditioner',
  stove: 'stove',
  candle: 'candle',
  bike: 'bike',
  jewelry: 'jewellery',
  camera: 'camera',
  laptop: 'laptop',
  tv: 'TV',
  instrument: 'musical instrument',
  blocked_exit: 'blocked exit',
  water_heater: 'water heater',
  unknown: 'something we could not name',
};

function plainName(label: string): string {
  return PLAIN_NAMES[label] ?? label.replace(/[_-]+/g, ' ').trim();
}

/**
 * Where to draw a marker between the ring's centre and its inner edge. Mirrors
 * engine `DISTANCE_BAND_RADIUS` (near 0.35, mid 0.65, far 0.95). Drawing
 * geometry only — contracts is type-only on the phone (DECISIONS R3-4).
 */
const BAND_RADIUS: Readonly<Record<string, number>> = { near: 0.35, mid: 0.65, far: 0.95 };
const BAND_WORDS: Readonly<Record<string, string>> = {
  near: 'close to you',
  mid: 'a few steps away',
  far: 'across the room',
};

function capitalise(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly sweep: SweepDto };

export default function ConfirmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const sessionSweepId = useSession((s) => s.sweepId);
  const sweepId = (typeof params.id === 'string' && params.id.length > 0 ? params.id : sessionSweepId) ?? null;

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const goToQuestions = useCallback(
    (replace: boolean) => {
      if (sweepId === null) return;
      const target = { pathname: '/questions' as const, params: { id: sweepId } };
      if (replace) router.replace(target);
      else router.push(target);
    },
    [router, sweepId],
  );

  const fetchSweep = useCallback(async () => {
    if (sweepId === null) return;
    setLoad({ kind: 'loading' });
    try {
      const sweep = await getApi().getSweep(sweepId);
      setLoad({ kind: 'ready', sweep });
    } catch (error) {
      setLoad({ kind: 'error', message: describeApiError(error) });
    }
  }, [sweepId]);

  useEffect(() => {
    void fetchSweep();
  }, [fetchSweep]);

  const items = load.kind === 'ready' ? load.sweep.needsConfirmation : [];

  // Nothing uncertain: there is nothing to check, so go straight on (M7-4).
  useEffect(() => {
    if (load.kind === 'ready' && load.sweep.needsConfirmation.length === 0) {
      AccessibilityInfo.announceForAccessibility('Nothing to check. Moving on to a few questions.');
      goToQuestions(true);
    }
  }, [load, goToQuestions]);

  const decidedCount = items.filter((o) => choices[o.id] !== undefined).length;
  const firstOpen = items.find((o) => choices[o.id] === undefined);

  const markers = useMemo(
    () =>
      items.map((o) => ({
        id: o.id,
        bearingDeg: o.bearingDeg,
        radius: BAND_RADIUS[o.distanceBand] ?? 0.65,
        label: plainName(o.label),
        highlighted: firstOpen !== undefined && o.id === firstOpen.id,
      })),
    [items, firstOpen],
  );

  const choose = (id: string, name: string, choice: Choice) => {
    setChoices((prev) => ({ ...prev, [id]: choice }));
    setSendError(null);
    Haptics.selectionAsync().catch(() => undefined);
    AccessibilityInfo.announceForAccessibility(
      choice === 'confirmed' ? `${capitalise(name)}: you said it is there.` : `${capitalise(name)}: you said it is not there.`,
    );
  };

  const submit = async () => {
    if (sweepId === null) return;
    const confirmations = items
      .filter((o) => choices[o.id] !== undefined)
      .map((o) => ({ observationId: o.id, confirmed: choices[o.id] === 'confirmed' }));
    if (confirmations.length === 0) {
      goToQuestions(false);
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await getApi().submitAnswers(sweepId, { answers: [], confirmations });
      goToQuestions(false);
    } catch (error) {
      setSendError(describeApiError(error));
    } finally {
      setSending(false);
    }
  };

  /* ------------------------------------------------------------------------ */

  if (sweepId === null) {
    return (
      <Screen title="Check what we found">
        <Notice tone="error" actionLabel="Start a new room" onAction={() => router.replace('/new')}>
          We could not find your room scan. Please start again.
        </Notice>
      </Screen>
    );
  }

  if (load.kind === 'loading') {
    return (
      <Screen title="Check what we found" subtitle="Loading what the camera saw.">
        <SkeletonCard accessibilityLabel="Loading what the camera saw" lines={2} />
        <SkeletonCard accessibilityLabel="Loading what the camera saw" lines={2} />
      </Screen>
    );
  }

  if (load.kind === 'error') {
    return (
      <Screen title="Check what we found">
        <Notice tone="error" actionLabel="Try again" onAction={() => void fetchSweep()}>
          {load.message}
        </Notice>
      </Screen>
    );
  }

  const sweep = load.sweep;
  const remaining = items.length - decidedCount;
  const continueLabel = remaining === 0 ? 'Continue' : decidedCount === 0 ? 'Skip checking' : 'Continue';
  const continueHint =
    remaining === 0
      ? 'Sends your answers and moves on to a few questions.'
      : `${remaining} ${remaining === 1 ? 'item is' : 'items are'} not checked yet. You can still go on; we will leave ${
          remaining === 1 ? 'it' : 'them'
        } as unsure.`;

  return (
    <Screen
      title="Check what we found"
      subtitle={
        items.length === 1
          ? 'The camera saw one thing it is not sure about. Tell us if it is really there.'
          : `The camera saw ${items.length} things it is not sure about. Tell us if each one is really there.`
      }
      footer={
        <>
          {sendError !== null ? (
            <Notice tone="error" actionLabel="Try again" onAction={() => void submit()}>
              {sendError}
            </Notice>
          ) : null}
          <Text variant="small" tone="muted" accessibilityElementsHidden importantForAccessibility="no">
            {`Checked ${decidedCount} of ${items.length}.`}
          </Text>
          <Button
            label={continueLabel}
            loading={sending}
            accessibilityHint={continueHint}
            onPress={() => void submit()}
          />
        </>
      }
    >
      {/* Hidden from screen readers: after the sweep its coverage sentence would
          say "turn slowly", and every item is already named and placed in words
          in the list below (M7-3). */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: SPACE.sm }}>
        <ScanRing
          panels={sweep.coverage?.panels ?? []}
          coveragePct={sweep.coverage?.coveragePct ?? null}
          headingDeg={null}
          markers={markers}
          showText={false}
        />
        <Text variant="small" tone="muted">
          The ring is your room seen from above, with where you started at the top. Each dot is one item below; dots
          nearer the middle were closer to you. The circled dot is the item to check next.
        </Text>
      </View>

      <View style={{ gap: SPACE.md }}>
        {items.map((o, i) => {
          const name = plainName(o.label);
          const where = `${capitalise(bearingWords(o.bearingDeg))}, ${BAND_WORDS[o.distanceBand] ?? 'in the room'}.`;
          const choice = choices[o.id];
          const status =
            choice === 'confirmed' ? 'You said: it is there.' : choice === 'dismissed' ? 'You said: it is not there.' : 'Not checked yet.';
          return (
            <Card key={o.id} tone={firstOpen?.id === o.id ? 'accent' : 'plain'}>
              <View accessible accessibilityRole="header" accessibilityLabel={`Item ${i + 1} of ${items.length}: ${name}. ${where} ${status}`}>
                <Heading variant="heading">{capitalise(name)}</Heading>
                <Text tone="muted">{where}</Text>
                <Text weight="semibold">{status}</Text>
                {firstOpen?.id === o.id ? (
                  <Text variant="small" tone="muted" accessibilityElementsHidden importantForAccessibility="no">
                    Next to check. Circled on the map.
                  </Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
                <AnswerButton
                  label="Yes, it's there"
                  a11yLabel={`Yes, there is a ${name}`}
                  selected={choice === 'confirmed'}
                  onPress={() => choose(o.id, name, 'confirmed')}
                />
                <AnswerButton
                  label="No, it isn't"
                  a11yLabel={`No, there is no ${name}`}
                  selected={choice === 'dismissed'}
                  onPress={() => choose(o.id, name, 'dismissed')}
                />
              </View>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

/** A toggle-style answer: selected shows a check mark and a thick border, not just a fill. */
function AnswerButton({
  label,
  a11yLabel,
  selected,
  onPress,
}: {
  label: string;
  a11yLabel: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        minWidth: MIN_TOUCH_TARGET,
        flexGrow: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACE.sm,
        paddingHorizontal: SPACE.lg,
        paddingVertical: SPACE.md,
        borderRadius: RADIUS.pill,
        borderWidth: selected ? 3 : BORDER.width,
        borderColor: selected ? COLORS.ink : COLORS.muted,
        backgroundColor: selected ? COLORS.ink : pressed ? COLORS.mutedTint : COLORS.paper,
      })}
    >
      <Text
        weight="semibold"
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ color: selected ? COLORS.paper : COLORS.mutedDeep }}
      >
        {selected ? '✓' : '○'}
      </Text>
      <Text weight="semibold" style={{ color: selected ? COLORS.paper : COLORS.ink, flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
