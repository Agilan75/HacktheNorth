import { useCallback, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { SweepDto } from '@retrofit/contracts';

import { describeApiError, getApi } from '@/lib/api';
import { sessionStore, useSession } from '@/lib/session';
import {
  Button,
  COLORS,
  Card,
  Heading,
  Hero,
  Icon,
  Notice,
  SPACE,
  Screen,
  SkeletonCard,
  Text,
  VerdictPill,
} from '@/ui';
import type { HeroTone, IconName } from '@/ui';

/**
 * Your quote — PRD §11 `/verdict` (unit M8).
 *
 * The verdict in words as well as colour, the price ESTIMATE with its
 * factor-by-factor breakdown exactly as the API returned it (PRD 6.7), the
 * deciding rule in plain words, the fix, "Verify my fix", and a Next-step sheet.
 *
 * Invariant (PRD 1): this screen does no arithmetic on money, scores or
 * verdicts. Every number shown is a field of the API's `EngineResult`; the only
 * client-side work is formatting and comparing a factor against 1 to choose the
 * words "raises" / "lowers".
 *
 * Params: `id` (optional) — the sweep id; falls back to the session's sweepId.
 */

type EngineResult = NonNullable<SweepDto['result']>;
type Price = EngineResult['price'];
type AppliedFactor = Price['factors'][number];
type Verdict = EngineResult['verdict']['verdict'];

/* -------------------------------------------------------------------------- */
/* Private presentation helpers (formatting only — no arithmetic on numbers)  */
/* -------------------------------------------------------------------------- */

function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'not available';
  const [whole = '0', cents = '00'] = Math.abs(n).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}$${grouped}.${cents}`;
}

/** Plain-language tenant wording for each verdict. The pill adds its own glyph. */
const VERDICT_WORDS: Readonly<Record<Verdict, string>> = {
  FIT: 'Good to cover',
  REFER: 'A person needs to review this',
  DOES_NOT_FIT: 'Can’t be covered as it is',
};

const VERDICT_SENTENCE: Readonly<Record<Verdict, string>> = {
  FIT: 'This room fits what the insurer covers.',
  REFER: 'This room might be covered, but a person at the insurer needs to look at it first.',
  DOES_NOT_FIT: 'As it is today, this room is outside what the insurer covers.',
};

/**
 * Decorative only — `VerdictPill` still prints the word and its own glyph.
 * FIT keeps red (the pill's own fill colour); REFER moves to blue (PRD §13:
 * "red never means bad", so a filled red Hero must stay reserved for FIT);
 * DOES_NOT_FIT matches the pill's ink fill.
 */
const HERO_TONE_BY_VERDICT: Readonly<Record<Verdict, HeroTone>> = {
  FIT: 'red',
  REFER: 'blue',
  DOES_NOT_FIT: 'ink',
};

const HAZARD_ICON: Readonly<Record<string, IconName>> = {
  portableHeater: 'flame-outline',
  heaterNearCombustible: 'flame-outline',
  extensionCord: 'flash-outline',
  powerBarOverload: 'flash-outline',
  candle: 'flame-outline',
  stove: 'restaurant-outline',
  blockedExit: 'exit-outline',
  windowAcUnit: 'snow-outline',
  waterHeater: 'water-outline',
  highValueContents: 'diamond-outline',
};

/** Decorative icon per priced factor — falls back to a neutral glyph. */
function factorIcon(name: string): IconName {
  const hazard = hazardKeyOfFactor(name);
  if (hazard !== null) return HAZARD_ICON[hazard] ?? 'warning-outline';
  switch (name) {
    case 'contents':
      return 'cube-outline';
    case 'buildingAge':
      return 'business-outline';
    case 'smokeDetector':
      return 'radio-button-on-outline';
    case 'term':
      return 'calendar-outline';
    default:
      return 'ellipse-outline';
  }
}

const HAZARD_NAMES: Readonly<Record<string, string>> = {
  portableHeater: 'Portable heater',
  heaterNearCombustible: 'Heater close to soft furnishings',
  extensionCord: 'Extension cord in use',
  powerBarOverload: 'Overloaded power bar',
  candle: 'Candle',
  stove: 'Stove',
  blockedExit: 'Blocked exit',
  windowAcUnit: 'Window air conditioner',
  waterHeater: 'Water heater',
  highValueContents: 'High-value items',
};

function humanize(key: string): string {
  const spaced = key.replace(/[._]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

function hazardName(hazardKey: string): string {
  return HAZARD_NAMES[hazardKey] ?? humanize(hazardKey);
}

/** `hazard.portableHeater` -> `portableHeater`; anything else -> null. */
function hazardKeyOfFactor(name: string): string | null {
  return name.startsWith('hazard.') ? name.slice('hazard.'.length) : null;
}

/** Flip component key `hazardPortableHeater` -> `portableHeater`. */
function hazardKeyOfComponent(componentKey: string): string | null {
  const m = /^hazard([A-Z].*)$/.exec(componentKey);
  if (m === null || m[1] === undefined) return null;
  return m[1].charAt(0).toLowerCase() + m[1].slice(1);
}

function factorName(name: string): string {
  const hazard = hazardKeyOfFactor(name);
  if (hazard !== null) return hazardName(hazard);
  switch (name) {
    case 'contents':
      return 'Value of your belongings';
    case 'buildingAge':
      return 'Age of the building';
    case 'smokeDetector':
      return 'Smoke detector';
    case 'term':
      return 'Length of the policy';
    default:
      return humanize(name);
  }
}

/** Words for the direction of a multiplier. A comparison, not a calculation. */
function factorEffect(factor: number): string {
  if (!Number.isFinite(factor)) return 'not known';
  if (factor > 1) return 'raises your price';
  if (factor < 1) return 'lowers your price';
  return 'no change';
}

function factorText(factor: number): string {
  return Number.isFinite(factor) ? `× ${String(factor)}` : '× ?';
}

/** Hazard keys the API priced in, in the API's order. */
function pricedHazards(price: Price): string[] {
  const out: string[] = [];
  for (const f of price.factors) {
    const k = hazardKeyOfFactor(f.name);
    if (k !== null && !out.includes(k)) out.push(k);
  }
  return out;
}

/** The hazard the Verify button should open on: the flip's first hazard move, else the first priced hazard. */
function defaultHazard(result: EngineResult): string | null {
  const priced = pricedHazards(result.price);
  for (const move of result.flip.flip?.moves ?? []) {
    const k = hazardKeyOfComponent(move.componentKey);
    if (k !== null && priced.includes(k)) return k;
  }
  return priced[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly sweep: SweepDto };

export default function VerdictScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const sessionSweepId = useSession((s) => s.sweepId);
  const sweepId = (typeof params.id === 'string' && params.id.length > 0 ? params.id : null) ?? sessionSweepId;

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const loaded = useRef(false);

  const fetchSweep = useCallback(
    (signal?: AbortSignal) => {
      if (sweepId === null) {
        setLoad({ kind: 'error', message: 'We don’t have a room scan to show yet. Start a new scan first.' });
        return;
      }
      if (!loaded.current) setLoad({ kind: 'loading' });
      getApi()
        .getSweep(sweepId, signal ? { signal } : undefined)
        .then((sweep) => {
          loaded.current = true;
          setLoad({ kind: 'ready', sweep });
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setLoad({ kind: 'error', message: describeApiError(error) });
        });
    },
    [sweepId],
  );

  // Re-read on every focus, so coming back from /verify-fix shows the new price.
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      fetchSweep(controller.signal);
      return () => controller.abort();
    }, [fetchSweep]),
  );

  if (load.kind === 'loading') {
    return (
      <Screen>
        <SkeletonCard accessibilityLabel="Loading your quote" lines={2} />
        <SkeletonCard accessibilityLabel="Loading your quote" lines={4} />
        <SkeletonCard accessibilityLabel="Loading your quote" lines={3} />
      </Screen>
    );
  }

  if (load.kind === 'error') {
    return (
      <Screen>
        <Notice tone="error" actionLabel={sweepId !== null ? 'Try again' : undefined} onAction={sweepId !== null ? () => fetchSweep() : undefined}>
          {load.message}
        </Notice>
        <Button label="Start a new scan" variant="secondary" onPress={() => router.replace('/new')} />
      </Screen>
    );
  }

  const { sweep } = load;
  const result = sweep.result;

  if (result === null) {
    return (
      <Screen>
        <Notice tone="info">
          {sweep.stage === 'failed'
            ? `We couldn’t finish checking this room.${sweep.error ? ` ${sweep.error}` : ''}`
            : 'Your quote isn’t ready yet. We’re still working it out.'}
        </Notice>
        {sweep.stage === 'failed' ? (
          <Button label="Scan the room again" onPress={() => router.replace('/new')} />
        ) : (
          <Button label="Check again" onPress={() => fetchSweep()} />
        )}
      </Screen>
    );
  }

  const verdict = result.verdict.verdict;
  const price = result.price;
  const hazards = pricedHazards(price);
  const verifyHazard = defaultHazard(result);
  const flip = result.flip.flip;
  const decidingRule = result.verdict.decidingRule;
  const why = result.verdict.reasons[0] ?? result.explanation ?? null;
  const moreReasons = result.verdict.reasons.slice(1);
  const questionsLeft = sweep.stage === 'questions';

  const openVerify = (hazardKey: string | null) => {
    router.push({
      pathname: '/verify-fix',
      params: { id: sweep.id, ...(hazardKey !== null ? { hazard: hazardKey } : {}) },
    });
  };

  return (
    <Screen
      footer={
        <>
          {verifyHazard !== null ? (
            <Button
              label="Verify my fix"
              accessibilityHint="Take one new photo of the thing you fixed. We re-check it and update your estimate."
              onPress={() => openVerify(verifyHazard)}
            />
          ) : null}
          <Button
            label="What happens next"
            variant="secondary"
            fullWidth
            accessibilityHint="Opens a sheet with your next steps."
            onPress={() => setSheetOpen(true)}
          />
        </>
      }
    >
      {/* Verdict */}
      <Hero
        tone={HERO_TONE_BY_VERDICT[verdict]}
        accessibilityLabel={`${sweep.roomLabel}. Result: ${VERDICT_WORDS[verdict]}. ${VERDICT_SENTENCE[verdict]}`}
      >
        <Text tone="inverse" variant="small">
          {sweep.roomLabel}
        </Text>
        {/* REFER's pill is outlined (transparent fill), which only has the
            contrast its redDeep text needs against Paper — never against a
            gradient. Every verdict gets the same opaque Paper plate here so
            none of them can quietly lose legibility on a coloured Hero. */}
        <View style={{ backgroundColor: COLORS.paper, borderRadius: 999, alignSelf: 'flex-start' }}>
          <VerdictPill
            verdict={verdict}
            text={VERDICT_WORDS[verdict]}
            size="large"
            accessibilityLabel={`Result: ${VERDICT_WORDS[verdict]}`}
          />
        </View>
        <Text tone="inverse">{VERDICT_SENTENCE[verdict]}</Text>
      </Hero>

      {questionsLeft ? (
        <Notice
          tone="info"
          actionLabel="Answer the questions"
          onAction={() => router.push('/questions')}
        >
          There are still a few questions. Answering them can change this result.
        </Notice>
      ) : null}

      {/* Estimate */}
      <Hero tone="blue" accessibilityRole="summary">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
          <Icon name="wallet-outline" size={20} color={COLORS.paper} />
          <Text tone="inverse" variant="heading" weight="semibold">
            Your price estimate
          </Text>
        </View>
        <View
          accessible
          accessibilityLabel={`Estimate: ${money(price.predictedMonthlyPremium)} a month. ${money(price.predictedPremium)} a year.`}
          style={{ gap: SPACE.xs }}
        >
          <Text variant="display" weight="semibold" tone="inverse">
            {money(price.predictedMonthlyPremium)}
            <Text variant="body" tone="inverse">
              {' '}a month
            </Text>
          </Text>
          <Text tone="inverse" style={{ opacity: 0.85 }}>
            {`${money(price.predictedPremium)} a year${price.termMonths !== null ? ` · ${String(price.termMonths)}-month policy` : ''}`}
          </Text>
        </View>
        <Text variant="small" tone="inverse" style={{ opacity: 0.85 }}>
          {price.estimate
            ? 'This is an estimate from a rating table, not a final price. An insurer confirms the real price.'
            : 'Worked out from the rating table.'}
        </Text>
      </Hero>

      <Card>
        <Heading variant="heading">How we got this number</Heading>
        <Text variant="small" tone="muted">
          We start from a base monthly rate and multiply it by each factor below. Change one factor and you can check
          the difference yourself.
        </Text>
        <View accessibilityRole="list" style={{ gap: SPACE.xs }}>
          {price.factors.map((f, i) => (
            <FactorRow
              key={`${f.name}-${String(i)}`}
              factor={f}
              onPress={
                hazardKeyOfFactor(f.name) !== null
                  ? () => router.push({ pathname: '/hazard/[id]', params: { id: hazardKeyOfFactor(f.name) ?? '' } })
                  : undefined
              }
            />
          ))}
        </View>
      </Card>

      {/* Deciding rule */}
      <Card>
        <Heading variant="heading">Why</Heading>
        {why !== null ? <Text>{why}</Text> : <Text tone="muted">No single rule decided this.</Text>}
        {moreReasons.length > 0 ? (
          <View style={{ gap: SPACE.xs }}>
            {moreReasons.map((r, i) => (
              <Text key={String(i)} variant="small" tone="muted">{`• ${r}`}</Text>
            ))}
          </View>
        ) : null}
        {decidingRule !== null ? (
          <>
            <Button
              label={ruleOpen ? 'Hide the rule we used' : 'Show the rule we used'}
              variant="quiet"
              fullWidth={false}
              accessibilityState={{ expanded: ruleOpen }}
              onPress={() => setRuleOpen((v) => !v)}
            />
            {ruleOpen ? (
              <View
                accessible
                accessibilityLabel={`From ${decidingRule.citation.doc}, ${decidingRule.citation.section}: ${decidingRule.citation.quote}`}
                style={{ borderLeftWidth: 3, borderLeftColor: COLORS.ink, paddingLeft: SPACE.md, gap: SPACE.xs }}
              >
                <Text variant="small" tone="muted">{`${decidingRule.citation.doc} · ${decidingRule.citation.section}`}</Text>
                <Text variant="small">{`“${decidingRule.citation.quote}”`}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </Card>

      {/* The fix */}
      <Card tone={flip !== null ? 'accent' : 'plain'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
          <Icon name="construct-outline" size={20} color={COLORS.ink} />
          <Heading variant="heading">What to fix</Heading>
        </View>
        {flip !== null ? (
          <>
            {flip.moves.map((m, i) => (
              <Text key={`${m.componentKey}-${String(i)}`}>{`• ${m.fixHint ?? m.label}`}</Text>
            ))}
            <View
              accessible
              accessibilityLabel={`If you do this, the result becomes ${VERDICT_WORDS[flip.verdictAfter]}. Estimate ${money(flip.premiumAfter)} a year instead of ${money(flip.premiumBefore)} a year.`}
              style={{ gap: SPACE.xs }}
            >
              <Text weight="semibold">{`If you do this: ${VERDICT_WORDS[flip.verdictAfter]}`}</Text>
              <Text>{`Estimate ${money(flip.premiumAfter)} a year, instead of ${money(flip.premiumBefore)} a year.`}</Text>
            </View>
          </>
        ) : verdict === 'FIT' ? (
          <Text>
            {hazards.length > 0
              ? 'Nothing needs fixing to be covered. Fixing the items marked “raises your price” above would lower your estimate.'
              : 'Nothing needs fixing. We didn’t find anything that raises your price.'}
          </Text>
        ) : (
          <Text>{result.flip.reason ?? 'We couldn’t find one change that would get this room covered.'}</Text>
        )}
        {hazards.length > 1 ? (
          <Text variant="small" tone="muted">
            Fixed something else? Tap “Verify my fix”, then choose which one.
          </Text>
        ) : null}
      </Card>

      <NextStepSheet
        visible={sheetOpen}
        verdict={verdict}
        canVerify={verifyHazard !== null}
        questionsLeft={questionsLeft}
        onClose={() => setSheetOpen(false)}
        onVerify={() => {
          setSheetOpen(false);
          openVerify(verifyHazard);
        }}
        onQuestions={() => {
          setSheetOpen(false);
          router.push('/questions');
        }}
        onNewRoom={() => {
          setSheetOpen(false);
          sessionStore.reset();
          router.replace('/new');
        }}
        onRooms={() => {
          setSheetOpen(false);
          router.replace('/');
        }}
      />
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function FactorRow({ factor, onPress }: { factor: AppliedFactor; onPress?: (() => void) | undefined }) {
  const name = factorName(factor.name);
  const effect = factorEffect(factor.factor);
  const label = `${name}: ${factor.input}. Multiplied by ${Number.isFinite(factor.factor) ? String(factor.factor) : 'unknown'}, ${effect}.`;
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: COLORS.mutedTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={factorIcon(factor.name)} size={16} color={COLORS.mutedDeep} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="semibold">{name}</Text>
        <Text variant="small" tone="muted">{`${factor.input} · ${effect}`}</Text>
      </View>
      <Text weight="semibold" style={{ fontVariant: ['tabular-nums'] }}>
        {factorText(factor.factor)}
      </Text>
    </View>
  );
  if (onPress) {
    return (
      <Card
        padding="md"
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityHint="Shows the photo and what changes if you fix it."
      >
        {body}
        <Text variant="small" tone="accent" importantForAccessibility="no" accessibilityElementsHidden>
          See what we found ›
        </Text>
      </Card>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, minHeight: 44, justifyContent: 'center' }}
    >
      {body}
    </View>
  );
}

interface NextStepSheetProps {
  readonly visible: boolean;
  readonly verdict: Verdict;
  readonly canVerify: boolean;
  readonly questionsLeft: boolean;
  readonly onClose: () => void;
  readonly onVerify: () => void;
  readonly onQuestions: () => void;
  readonly onNewRoom: () => void;
  readonly onRooms: () => void;
}

const NEXT_STEP_LEAD: Readonly<Record<Verdict, string>> = {
  FIT: 'You’re in good shape. Take this estimate to an insurer to get a real quote. Fixing any item that raises your price can bring it down first.',
  REFER: 'A person at the insurer will look at this before they can quote. Fixing what’s listed under “What to fix” can make that quicker or unnecessary.',
  DOES_NOT_FIT: 'As it is, an insurer would turn this down. Fix what’s listed under “What to fix”, then verify it with a photo to see the result change.',
};

function NextStepSheet(props: NextStepSheetProps) {
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
      accessibilityViewIsModal
    >
      <Screen edges={['top', 'bottom', 'left', 'right']} title="What happens next">
        <Text>{NEXT_STEP_LEAD[props.verdict]}</Text>
        <View style={{ gap: SPACE.md }}>
          {props.questionsLeft ? (
            <Button
              label="Answer the remaining questions"
              accessibilityHint="Answering can change your result."
              onPress={props.onQuestions}
            />
          ) : null}
          {props.canVerify ? (
            <Button
              label="Verify my fix"
              variant={props.questionsLeft ? 'secondary' : 'primary'}
              fullWidth
              accessibilityHint="Take one new photo of the thing you fixed."
              onPress={props.onVerify}
            />
          ) : null}
          <Button label="Scan another room" variant="secondary" fullWidth onPress={props.onNewRoom} />
          <Button label="See all my rooms" variant="secondary" fullWidth onPress={props.onRooms} />
          <Button label="Close" variant="quiet" fullWidth accessibilityHint="Back to your quote." onPress={props.onClose} />
        </View>
      </Screen>
    </Modal>
  );
}
