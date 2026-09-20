import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { HazardCostDto, SweepDto } from '@retrofit/contracts';

import { describeApiError, getApi } from '@/lib/api';
import { sessionStore, useSession } from '@/lib/session';
import {
  Button,
  COLORS,
  Card,
  ChoiceGroup,
  Heading,
  Icon,
  Notice,
  RADIUS,
  SPACE,
  Screen,
  SkeletonCard,
  Text,
  TextField,
  VerdictPill,
} from '@/ui';
import type { IconName } from '@/ui';

/**
 * The quote. Price, verdict, the three dearest findings with what each one
 * costs a month, one fix, the contents value the sweep derived, and at most one
 * optional question.
 *
 * Invariant: this screen does no arithmetic on money, scores or verdicts. Every
 * number is a field of the API's reply, including each finding's monthly cost,
 * which the API divides out of the engine's own factor composition.
 *
 * Everything the sweep derived or defaulted is editable here. An edit posts to
 * the existing answers endpoint and the price is replaced with the rescored one.
 */

type EngineResult = NonNullable<SweepDto['result']>;
type Verdict = EngineResult['verdict']['verdict'];

/** Whole dollars. Cents on a monthly renter premium are noise. */
function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'not priced';
  const whole = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}$${whole}`;
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

/**
 * The fix for each finding, in the renter's words. What each one saves comes
 * from the API (`hazardCosts.monthlyDelta`); this only says what to do.
 */
const HAZARD_TIP: Readonly<Record<string, { readonly title: string; readonly body: string }>> = {
  portableHeater: {
    title: 'Retire the space heater',
    body: 'Space heaters start more apartment fires than anything else in the room. Use the building heat, or unplug it whenever you leave.',
  },
  heaterNearCombustible: {
    title: 'Give the heater a metre of space',
    body: 'Curtains, bedding and sofas catch. One clear metre around the heater takes this finding off your quote.',
  },
  extensionCord: {
    title: 'Plug straight into the wall',
    body: 'Extension cords are for occasional use. Move the appliance closer to an outlet, or ask for one to be added.',
  },
  powerBarOverload: {
    title: 'Spread the load',
    body: 'Leave a socket free on every power bar, and never plug one bar into another.',
  },
  candle: {
    title: 'Swap to flameless candles',
    body: 'LED candles look the same on the shelf and cannot tip into a curtain.',
  },
  stove: {
    title: 'Keep the cooking area clear',
    body: 'Nothing that burns within reach of the burners, and a small extinguisher nearby.',
  },
  blockedExit: {
    title: 'Clear the way out',
    body: 'Keep a straight path to the door and to one window. Move whatever is in the way.',
  },
  windowAcUnit: {
    title: 'Secure the window unit',
    body: 'A support bracket underneath and a sealed frame keep it from falling and keep water out.',
  },
  waterHeater: {
    title: 'Put a pan and a leak alarm under it',
    body: 'A drip pan and a small leak sensor turn a flood into a puddle.',
  },
  highValueContents: {
    title: 'Lock up the valuables',
    body: 'A safe, or storage away from the unit, for camera gear, jewellery and instruments takes this factor off the quote.',
  },
};

const GENERIC_TIP = {
  title: 'Fix this finding',
  body: 'Remove or resolve it, then recheck with one photo.',
};

function humanize(key: string): string {
  const spaced = key.replace(/[._]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

const hazardName = (key: string): string => HAZARD_NAMES[key] ?? humanize(key);

/** The best value on a sourced field: the last one written wins. */
function latest(field: readonly { readonly value: unknown }[] | undefined): unknown {
  return field === undefined || field.length === 0 ? undefined : field[field.length - 1]?.value;
}

function numberOf(field: readonly { readonly value: unknown }[] | undefined): number | null {
  const v = latest(field);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
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
  const [saving, setSaving] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const loaded = useRef(false);

  const fetchSweep = useCallback(
    (signal?: AbortSignal) => {
      if (sweepId === null) {
        setLoad({ kind: 'error', message: 'No scan yet.' });
        return;
      }
      if (!loaded.current) setLoad({ kind: 'loading' });
      getApi()
        // Without the frame images: nothing here draws one, and carrying all
        // fifteen is about six megabytes for a screen that shows a price.
        .getSweep(sweepId, signal ? { images: false, signal } : { images: false })
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

  /** One rescore path for every correction on this screen. */
  const apply = useCallback(
    async (body: Parameters<ReturnType<typeof getApi>['submitAnswers']>[1]) => {
      if (sweepId === null) return;
      setSaveProblem(null);
      setSaving(true);
      try {
        const next = await getApi().submitAnswers(sweepId, body);
        setLoad({ kind: 'ready', sweep: next });
      } catch (error) {
        setSaveProblem(describeApiError(error));
      } finally {
        setSaving(false);
      }
    },
    [sweepId],
  );

  if (load.kind === 'loading') {
    return (
      <Screen>
        <SkeletonCard accessibilityLabel="Loading the quote" lines={2} />
        <SkeletonCard accessibilityLabel="Loading the quote" lines={4} />
      </Screen>
    );
  }

  if (load.kind === 'error') {
    return (
      <Screen>
        <Notice tone="error" actionLabel={sweepId !== null ? 'Try again' : undefined} onAction={sweepId !== null ? () => fetchSweep() : undefined}>
          {load.message}
        </Notice>
        <Button label="Scan a room" variant="secondary" onPress={() => router.replace('/scan')} />
      </Screen>
    );
  }

  const { sweep } = load;
  const result = sweep.result;

  if (result === null) {
    return (
      <Screen>
        <Notice tone="info">
          {sweep.stage === 'failed' ? (sweep.error ?? 'The scan could not be read.') : 'No price yet.'}
        </Notice>
        <Button
          label={sweep.stage === 'failed' ? 'Scan again' : 'Check again'}
          onPress={() => (sweep.stage === 'failed' ? router.replace('/scan') : fetchSweep())}
        />
        {/* Check again only refetches. Without this, a sweep the API never scores has no way out. */}
        <Button label="Back to your rooms" variant="secondary" onPress={() => router.dismissTo('/')} />
      </Screen>
    );
  }

  return (
    <Quote
      sweep={sweep}
      result={result}
      saving={saving}
      saveProblem={saveProblem}
      onApply={apply}
      onScanAgain={() => {
        sessionStore.reset();
        // Home, not `/scan`, and deliberately: `reset()` has just cleared the
        // room name and the term, and home is the only screen that sets them.
        // Going straight to the camera would send the next sweep unnamed.
        router.dismissTo('/');
      }}
      onVerify={(hazardKey) =>
        router.push({
          pathname: '/verify-fix',
          params: { id: sweep.id, ...(hazardKey !== null ? { hazard: hazardKey } : {}) },
        })
      }
      onHazard={(hazardKey) =>
        router.push({ pathname: '/hazard/[id]', params: { id: hazardKey, sweep: sweep.id } })
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* The quote                                                                  */
/* -------------------------------------------------------------------------- */

function Quote({
  sweep,
  result,
  saving,
  saveProblem,
  onApply,
  onScanAgain,
  onVerify,
  onHazard,
}: {
  readonly sweep: SweepDto;
  readonly result: EngineResult;
  readonly saving: boolean;
  readonly saveProblem: string | null;
  readonly onApply: (body: Parameters<ReturnType<typeof getApi>['submitAnswers']>[1]) => Promise<void>;
  readonly onScanAgain: () => void;
  readonly onVerify: (hazardKey: string | null) => void;
  readonly onHazard: (hazardKey: string) => void;
}) {
  const price = result.price;
  const verdict = result.verdict.verdict;
  const findings = sweep.hazardCosts.filter((h) => (h.monthlyDelta ?? 0) > 0);
  const flip = result.flip.flip;
  const fix = flip?.moves[0] ?? null;
  const contents = numberOf(result.canonical.exposure.contentsLimit);
  const yearBuilt = numberOf(result.canonical.buildings[0]?.yearBuilt);
  const question = sweep.pendingQuestion;
  const coverage = sweep.coverage;
  const short = coverage !== null && !coverage.sufficient;
  const term = price.termMonths ?? sweep.termMonths;
  const noSmokeDetector = price.factors.some((f) => f.name === 'smokeDetector' && f.input === 'absent');
  const monthly = money(price.predictedMonthlyPremium);

  return (
    <Screen
      footer={
        <>
          {findings.length > 0 ? (
            <Button
              label="Fixed something? Recheck"
              icon="camera-outline"
              accessibilityHint="Takes one photo of the fix and reprices."
              onPress={() => onVerify(findings[0]?.hazardKey ?? null)}
            />
          ) : null}
          <Button label="Scan another room" variant={findings.length > 0 ? 'secondary' : 'primary'} fullWidth onPress={onScanAgain} />
        </>
      }
    >
      {/* Price hero */}
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Estimated premium ${monthly} a month, ${money(price.predictedPremium)} a year on a ${String(term)}-month term. ${VERDICT_WORDS[verdict]}.`}
        style={{
          backgroundColor: COLORS.accent,
          borderRadius: RADIUS.card,
          padding: SPACE.xl,
          gap: SPACE.sm,
        }}
      >
        <Text variant="micro" weight="semibold">
          {`ESTIMATED PREMIUM · ${sweep.roomLabel.toUpperCase()}`}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm }}>
          <Text variant="display" weight="semibold">
            {monthly}
          </Text>
          <Text weight="semibold">/ month</Text>
        </View>
        <Text variant="small">
          {`${money(price.predictedPremium)} a year on a ${String(term)}-month term`}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
        <VerdictPill verdict={verdict} text={VERDICT_WORDS[verdict]} size="large" />
        {price.estimate ? (
          <Text variant="micro" tone="muted" style={{ flex: 1 }}>
            Estimate from a demo rate table. Not a binding quote.
          </Text>
        ) : null}
      </View>

      {saveProblem !== null ? <Notice tone="error">{saveProblem}</Notice> : null}

      {/* The one optional question, after the price, never before it. */}
      {question !== null ? (
        <QuestionCard
          question={question}
          saving={saving}
          onAnswer={(value) =>
            void onApply({ answers: [{ questionId: question.id, field: question.field, value }] })
          }
          onSkip={() =>
            void onApply({
              answers: [{ questionId: question.id, field: question.field, value: null, skipped: true }],
            })
          }
        />
      ) : null}

      {/* Ways to pay less: every finding with its fix and what fixing it saves. */}
      <View style={{ gap: SPACE.md }}>
        <View style={{ gap: 2 }}>
          <Heading variant="heading" accessibilityRole="header">
            Lower your price
          </Heading>
          <Text variant="small" tone="muted">
            {findings.length > 0
              ? `${String(findings.length)} ${findings.length === 1 ? 'thing' : 'things'} in this room ${findings.length === 1 ? 'adds' : 'add'} to your premium. Each one comes with a fix.`
              : 'Nothing in this room adds to your premium. This is already the best rate for this scan.'}
          </Text>
        </View>

        {fix !== null && flip !== null ? (
          <Card tone="accent" accessibilityLabel={`Best next step. ${fix.fixHint ?? fix.label}. Then ${money(flip.premiumAfter)} a year instead of ${money(flip.premiumBefore)}.`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
              <Icon name="sparkles-outline" size={18} color={COLORS.ink} />
              <Text variant="micro" weight="semibold">
                BEST NEXT STEP
              </Text>
            </View>
            <Text weight="semibold">{fix.fixHint ?? fix.label}</Text>
            <Text variant="small">
              {`Then ${money(flip.premiumAfter)} a year instead of ${money(flip.premiumBefore)}${flip.verdictAfter !== verdict ? `, and ${VERDICT_WORDS[flip.verdictAfter].toLowerCase()}` : ''}.`}
            </Text>
          </Card>
        ) : null}

        {findings.length > 0 ? (
          <View accessibilityRole="list" style={{ gap: SPACE.sm }}>
            {findings.map((h) => (
              <TipRow key={h.hazardKey} cost={h} onPress={() => onHazard(h.hazardKey)} />
            ))}
          </View>
        ) : null}

        {noSmokeDetector ? (
          <TipRow
            icon="radio-button-on-outline"
            title="Install a smoke detector"
            body="None was seen on the ceiling. One working detector in the unit lowers the rate and is required by most leases."
          />
        ) : null}

        {term < 12 ? (
          <TipRow
            icon="calendar-outline"
            title="Choose a 12-month term"
            body={`A ${String(term)}-month policy costs more per month than a full year. Change the term below to see the difference.`}
          />
        ) : null}
      </View>

      {/* Everything the sweep derived or defaulted, editable in place. */}
      <Card>
        <Heading variant="heading">Quote details</Heading>
        <NumberEdit
          label="Contents"
          value={contents}
          prefix="$"
          help="Summed from what the scan priced."
          saving={saving}
          onSave={(v) => void onApply({ answers: [], edits: [{ field: 'exposure.contentsLimit', value: v }] })}
        />
        <NumberEdit
          label="Year built"
          value={yearBuilt}
          help={yearBuilt === null ? 'Unknown.' : undefined}
          saving={saving}
          onSave={(v) => void onApply({ answers: [], edits: [{ field: 'buildings[0].yearBuilt', value: v }] })}
        />
        <TermEdit
          value={price.termMonths ?? sweep.termMonths}
          saving={saving}
          onSave={(v) => void onApply({ answers: [], edits: [{ field: 'exposure.termMonths', value: v }] })}
        />
        {short && coverage !== null ? (
          <Text variant="small" tone="muted">
            {`${String(Math.round(coverage.coveragePct))}% of the room scanned. A fuller scan tightens the price.`}
          </Text>
        ) : null}
      </Card>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One way to pay less. Given a `cost` it is a finding from the scan: the fix,
 * what it saves a month (the API's number), and a tap to the photo. Without
 * one it is a general tip with no dollar figure, because the phone never
 * computes money.
 */
function TipRow({
  cost,
  icon,
  title,
  body,
  onPress,
}: {
  readonly cost?: HazardCostDto;
  readonly icon?: IconName;
  readonly title?: string;
  readonly body?: string;
  readonly onPress?: () => void;
}) {
  const tip = cost !== undefined ? (HAZARD_TIP[cost.hazardKey] ?? GENERIC_TIP) : null;
  const heading = title ?? tip?.title ?? '';
  const words = body ?? tip?.body ?? '';
  const glyph = icon ?? (cost !== undefined ? (HAZARD_ICON[cost.hazardKey] ?? 'warning-outline') : 'bulb-outline');
  const saves = cost?.monthlyDelta ?? null;
  const found = cost !== undefined ? hazardName(cost.hazardKey) : null;
  const label = [found !== null ? `Found: ${found}.` : null, heading, words, saves !== null ? `Saves ${money(saves)} a month.` : null]
    .filter((s): s is string => s !== null)
    .join(' ');

  return (
    <Card
      padding="lg"
      {...(onPress !== undefined ? { onPress, accessibilityHint: 'Shows the photo and what fixing it does.' } : {})}
      accessibilityLabel={label}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: COLORS.muteTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={glyph} size={20} color={COLORS.ink} />
        </View>
        <View style={{ flex: 1, gap: SPACE.xs }}>
          {found !== null ? (
            <Text variant="micro" tone="muted" weight="semibold">
              {`FOUND: ${found.toUpperCase()}`}
            </Text>
          ) : null}
          <Text weight="semibold">{heading}</Text>
          <Text variant="small" tone="muted">
            {words}
          </Text>
        </View>
        {saves !== null ? (
          <View
            style={{
              paddingHorizontal: SPACE.sm,
              paddingVertical: 2,
              borderRadius: RADIUS.pill,
              backgroundColor: COLORS.accent,
            }}
          >
            <Text variant="micro" weight="semibold" style={{ fontVariant: ['tabular-nums'] }}>
              {`−${money(saves)}/mo`}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** A derived number, shown as a value until it is tapped, then an input. */
function NumberEdit({
  label,
  value,
  prefix,
  help,
  saving,
  onSave,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly prefix?: string;
  readonly help?: string;
  readonly saving: boolean;
  readonly onSave: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!editing) {
    const shown = value === null ? 'Unknown' : `${prefix ?? ''}${value.toLocaleString('en-US')}`;
    return (
      <Row
        label={label}
        value={shown}
        help={help}
        onEdit={() => {
          setDraft(value === null ? '' : String(value));
          setEditing(true);
        }}
      />
    );
  }

  const parsed = Number(draft.replace(/[^0-9.]/g, ''));
  const valid = Number.isFinite(parsed) && parsed > 0;
  return (
    <View style={{ gap: SPACE.sm }}>
      <TextField
        label={label}
        value={draft}
        onChangeText={setDraft}
        keyboardType="number-pad"
        autoFocus
        {...(help !== undefined ? { help } : {})}
        {...(draft.length > 0 && !valid ? { error: 'Numbers only.' } : {})}
      />
      <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
        <Button
          label="Save"
          fullWidth={false}
          disabled={!valid || saving}
          loading={saving}
          onPress={() => {
            setEditing(false);
            onSave(parsed);
          }}
        />
        <Button label="Cancel" variant="quiet" fullWidth={false} onPress={() => setEditing(false)} />
      </View>
    </View>
  );
}

/** The term is one of three values, so it edits as a choice, not a field. */
function TermEdit({
  value,
  saving,
  onSave,
}: {
  readonly value: number;
  readonly saving: boolean;
  readonly onSave: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return <Row label="Term" value={`${String(value)} months`} onEdit={() => setEditing(true)} />;
  }
  return (
    <ChoiceGroup
      label="Term"
      choices={[4, 8, 12].map((m) => ({ value: m, label: `${String(m)} months` }))}
      value={value}
      onChange={(v) => {
        setEditing(false);
        if (!saving && v !== value) onSave(v);
      }}
      direction="row"
    />
  );
}

function Row({
  label,
  value,
  help,
  onEdit,
}: {
  readonly label: string;
  readonly value: string;
  readonly help?: string;
  readonly onEdit: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 44 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="semibold">{`${label}  ${value}`}</Text>
        {help !== undefined ? (
          <Text variant="small" tone="muted">
            {help}
          </Text>
        ) : null}
      </View>
      <Button
        label="Edit"
        variant="quiet"
        fullWidth={false}
        accessibilityLabel={`Edit ${label.toLowerCase()}`}
        accessibilityHint="Changes the number and reprices."
        onPress={onEdit}
      />
    </View>
  );
}

/** The single optional question, inline, after the price. Never a screen. */
function QuestionCard({
  question,
  saving,
  onAnswer,
  onSkip,
}: {
  readonly question: NonNullable<SweepDto['pendingQuestion']>;
  readonly saving: boolean;
  readonly onAnswer: (value: string | number | boolean) => void;
  readonly onSkip: () => void;
}) {
  const [draft, setDraft] = useState('');
  const options = question.options ?? [];
  const parsed = Number(draft.replace(/[^0-9.]/g, ''));
  const valid = Number.isFinite(parsed) && parsed > 0;

  return (
    <Card tone="muted">
      <Text weight="semibold">{question.prompt}</Text>
      <Text variant="small" tone="muted">
        Optional. It tightens the price.
      </Text>
      {options.length > 0 ? (
        <ChoiceGroup
          label={question.prompt}
          choices={options.map((o) => ({ value: o.value, label: o.label }))}
          value={null}
          onChange={(v) => {
            if (!saving) onAnswer(v);
          }}
          direction="row"
        />
      ) : (
        <View style={{ gap: SPACE.sm }}>
          <TextField
            label={question.prompt}
            accessibilityLabel={question.accessibilityLabel}
            value={draft}
            onChangeText={setDraft}
            keyboardType="number-pad"
          />
          <Button
            label="Set"
            fullWidth={false}
            disabled={!valid || saving}
            loading={saving}
            onPress={() => onAnswer(parsed)}
          />
        </View>
      )}
      <Button label="Skip" variant="quiet" fullWidth={false} disabled={saving} onPress={onSkip} />
    </Card>
  );
}
