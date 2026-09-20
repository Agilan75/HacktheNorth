import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { SweepDto, VerifyFixResponseDto } from '@retrofit/contracts';

import { describeApiError, getApi } from '@/lib/api';
import { stripDataUrl, useSession } from '@/lib/session';
import {
  Button,
  COLORS,
  Card,
  ChoiceGroup,
  Heading,
  Notice,
  RADIUS,
  SPACE,
  Screen,
  SkeletonCard,
  Text,
  VerdictPill,
} from '@/ui';

/**
 * Verify your fix. PRD §11 `/verify-fix`, unit M8.
 *
 * ONE new photo of the fixed hazard (camera, or the photo library as an equal
 * alternative), POST /sweeps/:id/verify-fix, then the old and the new verdict
 * and estimate side by side. The API re-runs the engine; this screen does no
 * arithmetic on any number. It shows the before and after the API returned, and
 * says in words whether the second is lower, higher or the same.
 *
 * Params: `id` (optional, sweep id; falls back to the session) and `hazard`
 * (optional hazard key such as `portableHeater`; the user can change it).
 */

type EngineResult = NonNullable<SweepDto['result']>;
type Verdict = EngineResult['verdict']['verdict'];

/** Longest edge sent to the API. Keeps the upload small on venue Wi-Fi. */
const UPLOAD_WIDTH = 1280;
const UPLOAD_QUALITY = 0.7;

/* -------------------------------------------------------------------------- */
/* Private presentation helpers: formatting only, no arithmetic on numbers    */
/* -------------------------------------------------------------------------- */

function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'not available';
  const [whole = '0', cents = '00'] = Math.abs(n).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}$${grouped}.${cents}`;
}

const VERDICT_WORDS: Readonly<Record<Verdict, string>> = {
  FIT: 'Coverable',
  REFER: 'Needs review',
  DOES_NOT_FIT: 'Not coverable',
};

const HAZARD_NAMES: Readonly<Record<string, string>> = {
  portableHeater: 'Space heater',
  heaterNearCombustible: 'Heater near fabric',
  extensionCord: 'Extension cord',
  powerBarOverload: 'Overloaded power bar',
  candle: 'Open flame',
  stove: 'Stove',
  blockedExit: 'Blocked exit',
  windowAcUnit: 'Window AC',
  waterHeater: 'Water heater',
  highValueContents: 'High-value contents',
};

/** What a good "after" photo shows, per hazard. Plain language. */
const PHOTO_TIPS: Readonly<Record<string, string>> = {
  portableHeater: 'Show where the heater was, gone or unplugged.',
  heaterNearCombustible: 'Show the heater with fabric well clear of it.',
  extensionCord: 'Show the outlet where the cord was.',
  powerBarOverload: 'Show the power bar with few plugs in it.',
  candle: 'Show where the candle was.',
  blockedExit: 'Stand back. Show the doorway clear, floor to top.',
  windowAcUnit: 'Show the window where the unit was.',
};

function humanize(key: string): string {
  const spaced = key.replace(/[._]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

function hazardName(hazardKey: string): string {
  return HAZARD_NAMES[hazardKey] ?? humanize(hazardKey);
}

/** Hazard keys the API priced in (`hazard.<key>` factors), in the API's order. */
function pricedHazards(result: EngineResult): string[] {
  const out: string[] = [];
  for (const f of result.price.factors) {
    if (!f.name.startsWith('hazard.')) continue;
    const k = f.name.slice('hazard.'.length);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** Words for how `after` compares with `before`. A comparison, not a calculation. */
function direction(before: number | null, after: number | null): 'lower' | 'higher' | 'the same' | null {
  if (before === null || after === null || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  if (after < before) return 'lower';
  if (after > before) return 'higher';
  return 'the same';
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduce(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

interface Photo {
  readonly uri: string;
  readonly base64: string;
  readonly capturedAt: string;
}

interface Outcome {
  readonly response: VerifyFixResponseDto;
  /** The result the screen held before this check (for the monthly "before"). */
  readonly previous: EngineResult;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly sweepId: string; readonly result: EngineResult };

export default function VerifyFixScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; hazard?: string }>();
  const sessionSweepId = useSession((s) => s.sweepId);
  const sweepId = (typeof params.id === 'string' && params.id.length > 0 ? params.id : null) ?? sessionSweepId;

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [hazard, setHazard] = useState<string | null>(
    typeof params.hazard === 'string' && params.hazard.length > 0 ? params.hazard : null,
  );
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const fetchSweep = useCallback(() => {
    if (sweepId === null) {
      setLoad({ kind: 'error', message: 'No scan to check.' });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    getApi()
      .getSweep(sweepId, { signal: controller.signal })
      .then((sweep) => {
        if (sweep.result === null) {
          setLoad({ kind: 'error', message: 'No quote for this room yet.' });
          return;
        }
        setLoad({ kind: 'ready', sweepId: sweep.id, result: sweep.result });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ kind: 'error', message: describeApiError(error) });
      });
    return controller;
  }, [sweepId]);

  useEffect(() => {
    const controller = fetchSweep();
    return () => controller?.abort();
  }, [fetchSweep]);

  // Pick a sensible hazard once the list is known, keeping the param if it is valid.
  const hazards = load.kind === 'ready' ? pricedHazards(load.result) : [];
  useEffect(() => {
    if (load.kind !== 'ready') return;
    const list = pricedHazards(load.result);
    setHazard((h) => (h !== null && list.includes(h) ? h : (list[0] ?? h)));
  }, [load]);

  const takePhoto = async (source: 'camera' | 'library') => {
    setProblem(null);
    setPicking(true);
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setProblem('Camera access is off. Pick a photo from your library, or allow it in Settings.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
      const picked =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (asset === undefined) return;
      const rendered = await ImageManipulator.manipulate(asset.uri).resize({ width: UPLOAD_WIDTH }).renderAsync();
      const saved = await rendered.saveAsync({ base64: true, compress: UPLOAD_QUALITY, format: SaveFormat.JPEG });
      if (saved.base64 === undefined || saved.base64.length === 0) {
        setProblem('That photo could not be read. Try another.');
        return;
      }
      setPhoto({ uri: saved.uri, base64: stripDataUrl(saved.base64), capturedAt: new Date().toISOString() });
      setOutcome(null);
    } catch {
      setProblem('No photo. Try again, or pick one from your library.');
    } finally {
      setPicking(false);
    }
  };

  const send = async () => {
    if (load.kind !== 'ready' || photo === null || hazard === null) return;
    setProblem(null);
    setSending(true);
    // `load.result` is always the latest result: it is replaced after each check.
    const previous = load.result;
    const readySweepId = load.sweepId;
    try {
      const response = await getApi().verifyFix(readySweepId, {
        hazardKey: hazard,
        imageBase64: photo.base64,
        capturedAt: photo.capturedAt,
      });
      setOutcome({ response, previous });
      setLoad({ kind: 'ready', sweepId: readySweepId, result: response.result });
      const dir = direction(previous.price.predictedMonthlyPremium, response.result.price.predictedMonthlyPremium);
      if (dir === 'lower') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } else if (response.stillPresent) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      }
      AccessibilityInfo.announceForAccessibility(
        `${response.stillPresent ? 'Still there.' : 'Fixed.'} Your estimate is now ${money(
          response.result.price.predictedMonthlyPremium,
        )} a month, was ${money(previous.price.predictedMonthlyPremium)}.`,
      );
    } catch (error) {
      setProblem(describeApiError(error));
    } finally {
      setSending(false);
    }
  };

  const backToQuote = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/verdict', params: sweepId !== null ? { id: sweepId } : {} });
  };

  /* ------------------------------------------------------------ rendering */

  if (load.kind === 'loading') {
    return (
      <Screen>
        <SkeletonCard accessibilityLabel="Loading" lines={2} />
        <SkeletonCard accessibilityLabel="Loading" lines={3} />
      </Screen>
    );
  }

  if (load.kind === 'error') {
    return (
      <Screen>
        <Notice tone="error" actionLabel={sweepId !== null ? 'Try again' : undefined} onAction={sweepId !== null ? () => fetchSweep() : undefined}>
          {load.message}
        </Notice>
        <Button label="Back to the quote" variant="secondary" onPress={backToQuote} />
      </Screen>
    );
  }

  if (hazards.length === 0 && outcome === null) {
    return (
      <Screen>
        <Notice tone="info">Nothing in this room raises the price.</Notice>
        <Button label="Back to the quote" onPress={backToQuote} />
      </Screen>
    );
  }

  const selectedName = hazard !== null ? hazardName(hazard) : 'the item';

  return (
    <Screen
      footer={
        outcome === null ? (
          <Button
            label={sending ? 'Checking' : 'Check the fix'}
            loading={sending}
            disabled={photo === null || hazard === null}
            accessibilityHint={photo === null ? 'Take or choose a photo first.' : 'Sends the photo and reprices.'}
            onPress={() => {
              void send();
            }}
          />
        ) : (
          <Button label="Back to the quote" onPress={backToQuote} accessibilityHint="Shows the updated price." />
        )
      }
    >
      <Text>
        One clear photo of where it was. The price is recomputed from it.
      </Text>

      {hazards.length > 1 ? (
        <ChoiceGroup
          label="What was fixed"
          choices={hazards.map((k) => ({ value: k, label: hazardName(k) }))}
          value={hazard}
          onChange={(v) => {
            if (v === hazard) return;
            setHazard(v);
            setPhoto(null);
            setOutcome(null);
          }}
        />
      ) : (
        <Text weight="semibold">{`Checking  ${selectedName}`}</Text>
      )}

      {hazard !== null && PHOTO_TIPS[hazard] !== undefined ? (
        <Text variant="small" tone="muted">{PHOTO_TIPS[hazard]}</Text>
      ) : null}

      {/* Photo: camera and library are equal choices */}
      {photo !== null ? (
        <Image
          source={{ uri: photo.uri }}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`New photo of the ${selectedName.toLowerCase()}`}
          resizeMode="cover"
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: RADIUS.card, backgroundColor: COLORS.muteTint }}
        />
      ) : null}
      <View style={{ gap: SPACE.sm }}>
        <Button
          label={photo === null ? 'Take a photo' : 'Retake'}
          icon="camera-outline"
          variant={photo === null ? 'primary' : 'secondary'}
          fullWidth
          loading={picking}
          disabled={sending}
          accessibilityHint="Opens the camera for one photo."
          onPress={() => {
            void takePhoto('camera');
          }}
        />
        <Button
          label="Pick from library"
          icon="images-outline"
          variant="secondary"
          fullWidth
          disabled={sending || picking}
          accessibilityHint="Pick a photo already taken."
          onPress={() => {
            void takePhoto('library');
          }}
        />
      </View>

      {sending ? (
        <Text variant="small" tone="muted" accessibilityLiveRegion="polite">
          Checking. Up to a minute.
        </Text>
      ) : null}

      {problem !== null ? <Notice tone="error">{problem}</Notice> : null}

      {outcome !== null ? <Comparison outcome={outcome} hazardLabel={hazardName(outcome.response.hazardKey)} /> : null}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Before / after                                                             */
/* -------------------------------------------------------------------------- */

function Comparison({ outcome, hazardLabel }: { outcome: Outcome; hazardLabel: string }) {
  const { response, previous } = outcome;
  const reduce = useReduceMotion();
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      reveal.setValue(1);
      return undefined;
    }
    reveal.setValue(0);
    const anim = Animated.spring(reveal, { toValue: 1, useNativeDriver: true, friction: 6, tension: 60 });
    anim.start();
    return () => anim.stop();
  }, [reveal, reduce, response]);

  const beforeMonthly = previous.price.predictedMonthlyPremium;
  const afterMonthly = response.result.price.predictedMonthlyPremium;
  const dir = direction(beforeMonthly, afterMonthly);
  const beforeVerdict = response.before.verdict;
  const afterVerdict = response.after.verdict;

  const headline = response.stillPresent
    ? `The ${hazardLabel.toLowerCase()} is still there.`
    : `The ${hazardLabel.toLowerCase()} is gone.`;

  return (
    <View style={{ gap: SPACE.md }}>
      <Notice tone={response.stillPresent ? 'info' : 'success'}>{`${headline} ${response.reason}`}</Notice>

      <Heading variant="heading">Before and after</Heading>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md }}>
        <Card
          tone="muted"
          style={{ flexGrow: 1, flexBasis: 150 }}
          accessibilityLabel={`Before: ${VERDICT_WORDS[beforeVerdict]}. ${money(beforeMonthly)} a month. ${money(response.before.predictedPremium)} a year.`}
        >
          <Text variant="small" weight="semibold" tone="muted">
            Before
          </Text>
          <VerdictPill verdict={beforeVerdict} text={VERDICT_WORDS[beforeVerdict]} />
          <Text variant="heading" tone="muted" style={dir === 'lower' ? { textDecorationLine: 'line-through' } : undefined}>
            {money(beforeMonthly)}
          </Text>
          <Text variant="small" tone="muted">{`a month · ${money(response.before.predictedPremium)} a year`}</Text>
        </Card>

        <Animated.View
          style={{
            flexGrow: 1,
            flexBasis: 150,
            opacity: reveal,
            transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          }}
        >
          <Card
            tone={dir === 'lower' ? 'accent' : 'plain'}
            style={{ borderColor: COLORS.ink, borderWidth: 2 }}
            accessibilityLabel={`Now: ${VERDICT_WORDS[afterVerdict]}. ${money(afterMonthly)} a month. ${money(response.after.predictedPremium)} a year.${dir !== null ? ` That is ${dir} than before.` : ''}`}
          >
            <Text variant="small" weight="semibold">
              Now
            </Text>
            <VerdictPill verdict={afterVerdict} text={VERDICT_WORDS[afterVerdict]} />
            <Text variant="title" weight="semibold">
              {money(afterMonthly)}
            </Text>
            <Text variant="small">{`a month · ${money(response.after.predictedPremium)} a year`}</Text>
          </Card>
        </Animated.View>
      </View>

      <Text weight="semibold">
        {dir === 'lower'
          ? `Down. ${money(beforeMonthly)} to ${money(afterMonthly)} a month.`
          : dir === 'higher'
            ? `Up. ${money(beforeMonthly)} to ${money(afterMonthly)} a month.`
            : dir === 'the same'
              ? `Unchanged at ${money(afterMonthly)} a month.`
              : 'The two prices could not be compared.'}
      </Text>
      {beforeVerdict !== afterVerdict ? (
        <Text>{`${VERDICT_WORDS[beforeVerdict]} to ${VERDICT_WORDS[afterVerdict]}.`}</Text>
      ) : null}
      {response.stillPresent ? (
        <Text variant="small" tone="muted">
          If it is fixed, try again from further back, in better light.
        </Text>
      ) : null}
      <Text variant="small" tone="muted">
        {response.stillPresent
          ? 'Both are estimates.'
          : 'Both are estimates. This item no longer carries a price factor.'}
      </Text>
    </View>
  );
}
