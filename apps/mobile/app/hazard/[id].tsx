import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image, View } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { SweepDto } from '@retrofit/contracts';

import { describeApiError, getApi } from '@/lib/api';
import {
  HAZARD_WORDS,
  bearingWords,
  cropRect,
  findHazardPhoto,
  hazardComponentKey,
  hazardKeyFromId,
  hazardStatus,
  type HazardPhoto,
} from '@/lib/photos';
import { useSession } from '@/lib/session';
import { BORDER } from '@retrofit/design';
import {
  Button,
  COLORS,
  Card,
  Heading,
  Icon,
  Notice,
  RADIUS,
  SPACE,
  Screen,
  SkeletonCard,
  Text,
  VerdictPill,
} from '@/ui';
import type { IconName } from '@/ui';

/**
 * What we found — PRD §11 `/hazard/[id]` (unit M9).
 *
 * The close-up photo (cropped to the model's `box_2d`, PRD 9.3 step 6), what
 * the hazard is and why it matters, and what fixing it does to the verdict and
 * the price. Every number on this screen is read from the API's sweep result:
 * the verdict and price "if fixed" come from the engine's flip, never from
 * arithmetic here.
 *
 * Route: `/hazard/<id>?sweep=<sweepId>&obs=<observationId>`. `id` may be a
 * hazard key (`candle`), a canonical path, a vector component key or an
 * observation id. `sweep` defaults to the session's sweep.
 */

type EngineResult = NonNullable<SweepDto['result']>;
type Verdict = EngineResult['verdict']['verdict'];

/** Tenant-facing verdict words (PRD 11: plain language). The pill adds a glyph too. */
const VERDICT_WORDS: Readonly<Record<Verdict, string>> = {
  FIT: 'We can quote you',
  REFER: 'An underwriter needs a quick look',
  DOES_NOT_FIT: 'We cannot quote this yet',
};

function money(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly sweep: SweepDto };

export default function HazardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; sweep?: string; obs?: string }>();
  const id = firstParam(params.id) ?? '';
  const sessionSweepId = useSession((s) => s.sweepId);
  const sweepId = firstParam(params.sweep) ?? sessionSweepId;
  const preferredObs = firstParam(params.obs) ?? null;

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!sweepId) {
      setLoad({ status: 'missing' });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    getApi()
      .getSweep(sweepId, { signal: controller.signal })
      .then((sweep) => setLoad({ status: 'ready', sweep }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', message: describeApiError(error) });
      });
    return () => controller.abort();
  }, [sweepId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (load.status === 'loading') {
    return (
      <Screen>
        <SkeletonCard accessibilityLabel="Loading what we found" lines={1} />
        <SkeletonCard accessibilityLabel="Loading what we found" lines={3} />
      </Screen>
    );
  }
  if (load.status === 'missing') {
    return (
      <Screen title="We could not find this room">
        <Notice tone="error">Open this from your quote, after a scan or photos of the room.</Notice>
        <Button label="Go to your rooms" onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  if (load.status === 'error') {
    return (
      <Screen>
        <Notice tone="error" actionLabel="Try again" onAction={retry}>
          {load.message}
        </Notice>
      </Screen>
    );
  }
  return <HazardDetail sweep={load.sweep} id={id} preferredObs={preferredObs} />;
}

/* -------------------------------------------------------------------------- */

function HazardDetail({
  sweep,
  id,
  preferredObs,
}: {
  readonly sweep: SweepDto;
  readonly id: string;
  readonly preferredObs: string | null;
}) {
  const router = useRouter();
  const hazardKey = useMemo(() => hazardKeyFromId(id, sweep.observations), [id, sweep]);
  // Memoised so the crop effect below runs once per photo, not once per render.
  const photo = useMemo(
    () => (hazardKey === null ? null : findHazardPhoto(sweep, hazardKey, preferredObs)),
    [sweep, hazardKey, preferredObs],
  );
  const result = sweep.result;

  if (hazardKey === null) {
    return (
      <Screen title="We could not find that item">
        <Notice tone="error">This link does not match anything we found in the room.</Notice>
        <Button label="Back to your quote" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const words = HAZARD_WORDS[hazardKey] ?? { name: 'Something we found', why: '', fix: '' };
  const componentKey = hazardComponentKey(hazardKey);
  const status = hazardStatus(result, hazardKey);

  // Everything below is read from the API's result, never computed here.
  const firedRule = result?.evaluate.firedRules.find((r) => r.conditions.some((c) => c.field === componentKey)) ?? null;
  const priceFactor = result?.price.factors.find((f) => f.name === `hazard.${hazardKey}`) ?? null;
  const flip = result?.flip.flip ?? null;
  const move = flip?.moves.find((m) => m.componentKey === componentKey) ?? null;
  const otherMoves = move === null || flip === null ? [] : flip.moves.filter((m) => m !== move);
  const fixText = move?.fixHint ?? words.fix;

  return (
    <Screen
      footer={
        <>
          {status === 'present' && hazardKey !== 'highValueContents' ? (
            <Button
              label="I fixed it: check with a new photo"
              icon="camera-outline"
              accessibilityHint="Opens the camera so you can take one photo showing the fix. We then update your quote."
              onPress={() => router.push({ pathname: '/verify-fix', params: { hazard: hazardKey, sweep: sweep.id } })}
            />
          ) : null}
          <Button label="Back to your quote" variant="secondary" onPress={() => router.back()} />
        </>
      }
    >
      <Stack.Screen options={{ title: words.name }} />

      <View style={{ gap: SPACE.sm }}>
        <Heading>{words.name}</Heading>
        <StatusLine status={status} hazardKey={hazardKey} />
      </View>

      <HazardImage photo={photo} name={words.name} />

      <Card>
        <Heading variant="heading">Why it matters</Heading>
        {words.why ? <Text>{words.why}</Text> : null}
        {firedRule ? (
          <View
            accessible
            accessibilityLabel={`From the insurer's rules, ${firedRule.citation.section}: ${firedRule.citation.quote}`}
            style={{ gap: SPACE.xs, borderLeftWidth: 3, borderLeftColor: COLORS.muted, paddingLeft: SPACE.md }}
          >
            <Text variant="small" tone="muted">
              {`The insurer's rule (${firedRule.citation.section}):`}
            </Text>
            <Text variant="small">{`“${firedRule.citation.quote}”`}</Text>
          </View>
        ) : null}
        {priceFactor && priceFactor.factor !== 1 ? (
          <Text variant="small" tone="muted">
            {priceFactor.factor > 1
              ? `While it is there, this part of your price is multiplied by ${priceFactor.factor.toFixed(2)}.`
              : `This part of your price is multiplied by ${priceFactor.factor.toFixed(2)}.`}
          </Text>
        ) : null}
      </Card>

      {status === 'present' && fixText ? (
        <Card>
          <Heading variant="heading">How to fix it</Heading>
          <Text>{fixText}</Text>
        </Card>
      ) : null}

      <IfFixedCard
        status={status}
        result={result}
        hasFlip={flip !== null}
        hasMove={move !== null}
        otherMoveLabels={otherMoves.map((m) => m.label)}
        verdictAfter={flip?.verdictAfter ?? null}
        premiumBefore={flip?.premiumBefore ?? null}
        premiumAfter={flip?.premiumAfter ?? null}
      />
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

const STATUS_ICON: Readonly<Record<ReturnType<typeof hazardStatus>, IconName>> = {
  fixed: 'checkmark-circle',
  present: 'alert-circle',
  absent: 'checkmark-circle-outline',
  unknown: 'help-circle-outline',
};

function StatusLine({ status, hazardKey }: { readonly status: ReturnType<typeof hazardStatus>; readonly hazardKey: string }) {
  const text =
    status === 'fixed'
      ? 'Fixed. Your new photo showed it is gone, and your quote was updated.'
      : status === 'absent'
        ? hazardKey === 'smokeDetectorCount'
          ? 'We saw a smoke detector, so this is fine.'
          : 'This is not counted against your quote.'
        : status === 'present'
          ? hazardKey === 'smokeDetectorCount'
            ? 'We did not see a smoke detector on the ceiling.'
            : 'We saw this in your room. It affects your quote.'
          : 'We are not sure about this one yet.';
  const word = status === 'fixed' ? 'Fixed' : status === 'present' ? 'Found' : status === 'absent' ? 'OK' : 'Unsure';
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={`${word}. ${text}`} style={{ flexDirection: 'row', gap: SPACE.sm, alignItems: 'flex-start' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACE.xs,
          borderWidth: 2,
          borderColor: COLORS.ink,
          backgroundColor: status === 'present' ? COLORS.ink : COLORS.paper,
          borderRadius: RADIUS.pill,
          paddingHorizontal: SPACE.md,
          paddingVertical: SPACE.xs,
        }}
      >
        <Icon name={STATUS_ICON[status]} size={14} color={status === 'present' ? COLORS.paper : COLORS.ink} />
        <Text variant="small" weight="semibold" style={{ color: status === 'present' ? COLORS.paper : COLORS.ink }}>
          {word}
        </Text>
      </View>
      <Text tone="muted" style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

type Cropped = { readonly uri: string; readonly width: number; readonly height: number };

/** Crops the frame to `box_2d` on the device. The API's cropToBox is not exposed as a route. */
async function cropFrame(photo: HazardPhoto): Promise<{ full: Cropped; crop: Cropped | null }> {
  const full = await ImageManipulator.manipulate(photo.imageRef).renderAsync();
  const fullOut = { uri: photo.imageRef, width: full.width, height: full.height };
  if (photo.box2d === null) return { full: fullOut, crop: null };
  const rect = cropRect(photo.box2d, full.width, full.height);
  if (rect === null) return { full: fullOut, crop: null };
  const ref = await ImageManipulator.manipulate(photo.imageRef).crop(rect).renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { full: fullOut, crop: { uri: saved.uri, width: saved.width, height: saved.height } };
}

function HazardImage({ photo, name }: { readonly photo: HazardPhoto | null; readonly name: string }) {
  const [images, setImages] = useState<{ full: Cropped; crop: Cropped | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [showWhole, setShowWhole] = useState(false);

  useEffect(() => {
    let alive = true;
    setImages(null);
    setFailed(false);
    if (photo === null) return undefined;
    cropFrame(photo)
      .then((out) => {
        if (alive) setImages(out);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [photo]);

  const where = useMemo(() => (photo ? bearingWords(photo.frame.bearingDeg) : ''), [photo]);

  if (photo === null) {
    return (
      <Card tone="muted">
        <Text>There is no photo to show for this one.</Text>
      </Card>
    );
  }

  // Fallback: the whole frame from the API, uncropped, sized once it loads.
  if (failed || images === null) {
    return (
      <View style={{ gap: SPACE.sm }}>
        {failed ? null : <SkeletonCard accessibilityLabel="Loading the photo" lines={1} />}
        {failed ? (
          <FramedImage
            uri={photo.imageRef}
            aspect={4 / 3}
            label={`Photo from your room, ${where}, showing the ${name.toLowerCase()}.`}
          />
        ) : null}
      </View>
    );
  }

  const crop = images.crop;
  const showingCrop = crop !== null && !showWhole;
  const shown = showingCrop ? crop : images.full;
  return (
    <View style={{ gap: SPACE.sm }}>
      <FramedImage
        uri={shown.uri}
        aspect={shown.width > 0 && shown.height > 0 ? shown.width / shown.height : 4 / 3}
        label={
          showingCrop
            ? `Close-up photo of the ${name.toLowerCase()} from your room, ${where}.`
            : `Whole photo from your room, ${where}.${photo.box2d ? ` The ${name.toLowerCase()} is marked with a box.` : ''}`
        }
        box={!showingCrop ? photo.box2d : null}
      />
      <Text variant="small" tone="muted">
        {`Taken ${where}.`}
      </Text>
      {crop !== null ? (
        <Button
          variant="quiet"
          fullWidth={false}
          label={showWhole ? 'Show the close-up' : 'Show the whole photo'}
          accessibilityHint={showWhole ? 'Zooms in on the item.' : 'Shows the full photo with the item marked by a box.'}
          onPress={() => setShowWhole((v) => !v)}
        />
      ) : null}
    </View>
  );
}

function FramedImage({
  uri,
  aspect,
  label,
  box = null,
}: {
  readonly uri: string;
  readonly aspect: number;
  readonly label: string;
  readonly box?: readonly [number, number, number, number] | null;
}) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? Math.min(3, Math.max(0.5, aspect)) : 4 / 3;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width: '100%',
        aspectRatio: safeAspect,
        borderRadius: RADIUS.card,
        borderWidth: BORDER.width,
        borderColor: BORDER.color,
        overflow: 'hidden',
        backgroundColor: COLORS.mutedTint,
      }}
    >
      <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
      {box ? (
        // A double outline (ink inside paper) reads on light and dark photos; it is a shape, not a colour cue.
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{
            position: 'absolute',
            top: `${Math.min(box[0], box[2]) / 10}%`,
            left: `${Math.min(box[1], box[3]) / 10}%`,
            height: `${Math.abs(box[2] - box[0]) / 10}%`,
            width: `${Math.abs(box[3] - box[1]) / 10}%`,
            borderWidth: 3,
            borderColor: COLORS.paper,
            borderRadius: 6,
          }}
        >
          <View style={{ flex: 1, borderWidth: 2, borderColor: COLORS.ink, borderRadius: 4 }} />
        </View>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function IfFixedCard({
  status,
  result,
  hasFlip,
  hasMove,
  otherMoveLabels,
  verdictAfter,
  premiumBefore,
  premiumAfter,
}: {
  readonly status: ReturnType<typeof hazardStatus>;
  readonly result: EngineResult | null;
  readonly hasFlip: boolean;
  readonly hasMove: boolean;
  readonly otherMoveLabels: readonly string[];
  readonly verdictAfter: Verdict | null;
  readonly premiumBefore: number | null;
  readonly premiumAfter: number | null;
}) {
  if (result === null) return null;
  const now = result.verdict.verdict;
  const nowPrice = money(result.price.predictedMonthlyPremium);

  if (status === 'fixed' || status === 'absent') {
    return (
      <Card>
        <Heading variant="heading">Your quote now</Heading>
        <VerdictPill verdict={now} text={VERDICT_WORDS[now]} />
        {nowPrice ? <Text>{`About ${nowPrice} a month.`}</Text> : null}
      </Card>
    );
  }

  if (hasMove && verdictAfter !== null) {
    const before = money(premiumBefore);
    const after = money(premiumAfter);
    const also =
      otherMoveLabels.length > 0 ? ` This needs one more change as well: ${otherMoveLabels.join(', ')}.` : '';
    const sentence = `If you fix this, your result becomes: ${VERDICT_WORDS[verdictAfter]}.${
      after ? ` Your price becomes about ${after} a year${before ? `, instead of ${before} now` : ''}.` : ''
    }${also}`;
    return (
      <Card tone="accent" accessibilityLabel={sentence}>
        <Heading variant="heading">If you fix this</Heading>
        <Text>Your result becomes</Text>
        <VerdictPill verdict={verdictAfter} text={VERDICT_WORDS[verdictAfter]} size="large" />
        {after ? (
          <Text>
            {'Your price becomes about '}
            <Text weight="semibold">{`${after} a year`}</Text>
            {before ? `, instead of ${before} now.` : '.'}
          </Text>
        ) : null}
        {also ? <Text variant="small">{also.trim()}</Text> : null}
      </Card>
    );
  }

  return (
    <Card>
      <Heading variant="heading">If you fix this</Heading>
      <Text>
        {now === 'FIT'
          ? 'You can already get a quote. Fixing this still makes your home safer, and it may lower your price.'
          : hasFlip
            ? 'Fixing this alone is not the change that gets you a quote. Your quote page shows the change that does.'
            : 'We could not find one simple change that gets you a quote. Fixing this still makes your home safer.'}
      </Text>
      <Text variant="small" tone="muted">
        Fix it and take a new photo, and we will re-price your quote with the real numbers.
      </Text>
      <VerdictPill verdict={now} text={`Now: ${VERDICT_WORDS[now]}`} />
      {nowPrice ? <Text variant="small">{`Your price now: about ${nowPrice} a month.`}</Text> : null}
    </Card>
  );
}
