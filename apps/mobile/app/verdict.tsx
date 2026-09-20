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
        <Button label="Scan a room" variant="secondary" onPress={() => router.replace('/')} />
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
          onPress={() => (sweep.stage === 'failed' ? router.replace('/') : fetchSweep())}
        />
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
        router.replace('/');
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
  const top = sweep.hazardCosts.filter((h) => (h.monthlyDelta ?? 0) > 0).slice(0, 3);
  const flip = result.flip.flip;
  const fix = flip?.moves[0] ?? null;
  const contents = numberOf(result.canonical.exposure.contentsLimit);
  const yearBuilt = numberOf(result.canonical.buildings[0]?.yearBuilt);
  const question = sweep.pendingQuestion;
  const coverage = sweep.coverage;
  const short = coverage !== null && !coverage.sufficient;

  return (
    <Screen
      footer={
        <>
          {top.length > 0 ? (
            <Button
              label="Fixed it? Recheck"
              accessibilityHint="Takes one photo of the fix and reprices."
              onPress={() => onVerify(top[0]?.hazardKey ?? null)}
            />
          ) : null}
          <Button label="Scan another room" variant="secondary" fullWidth onPress={onScanAgain} />
        </>
      }
    >
      {/* Price */}
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`${money(price.predictedMonthlyPremium)} a month. ${money(price.predictedPremium)} a year. ${VERDICT_WORDS[verdict]}.`}
        style={{ gap: SPACE.xs }}
      >
        <Text variant="small" tone="muted">
          {sweep.roomLabel}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm }}>
          <Text variant="display" weight="semibold" tone="accent">
            {money(price.predictedMonthlyPremium)}
          </Text>
          <Text tone="muted">a month</Text>
        </View>
        <Text variant="small" tone="muted">
          {`${money(price.predictedPremium)} a year · ${String(price.termMonths ?? sweep.termMonths)}-month term`}
        </Text>
        {price.estimate ? (
          <Text variant="small" tone="muted">
            Demo rate
          </Text>
        ) : null}
      </View>

      <VerdictPill verdict={verdict} text={VERDICT_WORDS[verdict]} size="large" />

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

      {/* Top three findings, dearest first, each with what it costs a month. */}
      {top.length > 0 ? (
        <Card>
          <Heading variant="heading">What costs you</Heading>
          <View accessibilityRole="list" style={{ gap: SPACE.xs }}>
            {top.map((h) => (
              <HazardRow key={h.hazardKey} cost={h} onPress={() => onHazard(h.hazardKey)} />
            ))}
          </View>
        </Card>
      ) : null}

      {/* One fix. */}
      <Card tone={fix !== null ? 'accent' : 'plain'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
          <Icon name="construct-outline" size={18} color={COLORS.ink} />
          <Heading variant="heading">Fix</Heading>
        </View>
        {fix !== null && flip !== null ? (
          <View
            accessible
            accessibilityLabel={`${fix.fixHint ?? fix.label}. Then ${VERDICT_WORDS[flip.verdictAfter]}, ${money(flip.premiumAfter)} a year instead of ${money(flip.premiumBefore)}.`}
            style={{ gap: SPACE.xs }}
          >
            <Text weight="semibold">{fix.fixHint ?? fix.label}</Text>
            <Text variant="small">
              {`Then ${VERDICT_WORDS[flip.verdictAfter]}. ${money(flip.premiumAfter)} a year, from ${money(flip.premiumBefore)}.`}
            </Text>
          </View>
        ) : (
          <Text>{result.flip.reason ?? 'Nothing to fix.'}</Text>
        )}
      </Card>

      {/* Everything the sweep derived or defaulted, editable in place. */}
      <Card>
        <Heading variant="heading">From the scan</Heading>
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

function HazardRow({ cost, onPress }: { readonly cost: HazardCostDto; readonly onPress: () => void }) {
  const name = hazardName(cost.hazardKey);
  const delta = cost.monthlyDelta;
  return (
    <Card
      padding="md"
      onPress={onPress}
      accessibilityLabel={`${name}. ${money(delta)} a month.`}
      accessibilityHint="Shows the photo and what fixing it does."
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
        <Icon name={HAZARD_ICON[cost.hazardKey] ?? 'warning-outline'} size={18} color={COLORS.mute} />
        <Text weight="semibold" style={{ flex: 1 }}>
          {name}
        </Text>
        <Text weight="semibold" style={{ fontVariant: ['tabular-nums'] }}>
          {`+${money(delta)}/mo`}
        </Text>
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
