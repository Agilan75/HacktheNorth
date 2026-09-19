import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { NextQuestionResponseDto } from '@retrofit/contracts';
import { BORDER } from '@retrofit/design';

import { describeApiError, getApi, isRestingStage, pollSweep } from '@/lib/api';
import { useSession } from '@/lib/session';
import {
  Button,
  COLORS,
  Card,
  ChoiceGroup,
  Heading,
  MIN_TOUCH_TARGET,
  Notice,
  RADIUS,
  SPACE,
  Screen,
  SkeletonCard,
  Text,
  TextField,
} from '@/ui';

/**
 * A few questions — PRD §11 `/questions`, PRD 6.3 stage 11 `voi` (unit M7).
 *
 * One plain-language question at a time from GET /sweeps/:id/next-question,
 * answered (or skipped) through POST /sweeps/:id/answers. The API chooses the
 * question, re-scores after every answer and says which fields it chose not to
 * ask, each with a one-line reason; this screen renders all of that and
 * computes nothing (PRD invariant: no client decides a number).
 *
 * "Questions skipped: N" is a button that expands to the field and the API's
 * reason for each skipped one.
 *
 * Inclusivity: the question is a heading and is announced when it changes;
 * every input has a visible label and a screen-reader label (the API's own
 * `accessibilityLabel` for the question); selected options carry a check mark,
 * not only a fill; "Skip — I'm not sure" is always offered next to "Next";
 * every target is at least 44pt and all text follows the OS text size.
 */

type Question = NonNullable<NextQuestionResponseDto['question']>;
type AnswerValue = string | number | boolean | null;

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly failed: boolean }
  | { readonly kind: 'ready'; readonly next: NextQuestionResponseDto };

/** "buildings[0].yearBuilt" → "year built"; "hazards.portableHeater" → "portable heater". */
function plainField(field: string): string {
  const last = field.split('.').pop() ?? field;
  const words = last
    .replace(/\[\d+\]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.length > 0 ? words : field;
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * Reads the typed text as a number, or explains in plain words why not. This
 * only parses what the person typed; the API checks and uses it (M7-6).
 */
function readNumber(raw: string): { ok: true; value: number } | { ok: false; problem: string } {
  const cleaned = raw.replace(/[\s,]/g, '');
  if (cleaned.length === 0) return { ok: false, problem: 'Type a number, or choose "Skip".' };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, problem: 'Use digits only, like 2 or 1995.' };
  if (n < 0) return { ok: false, problem: 'The number cannot be below zero.' };
  return { ok: true, value: n };
}

export default function QuestionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const sessionSweepId = useSession((s) => s.sweepId);
  const sweepId = (typeof params.id === 'string' && params.id.length > 0 ? params.id : sessionSweepId) ?? null;

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [sending, setSending] = useState<'answer' | 'skip' | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  // One draft per input kind; reset whenever the question changes.
  const [choice, setChoice] = useState<string | null>(null);
  const [multi, setMulti] = useState<readonly string[]>([]);
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Fetches the next question. If the API has not scored the sweep yet (no
   * question, not done), waits for the sweep to reach a resting stage first
   * and asks again (M7-5).
   */
  const fetchNext = useCallback(
    async (showSkeleton: boolean) => {
      if (sweepId === null) return;
      if (showSkeleton) setLoad({ kind: 'loading' });
      const api = getApi();
      try {
        let next = await api.nextQuestion(sweepId);
        if (next.question === null && !next.done) {
          let sweep = await api.getSweep(sweepId);
          if (!isRestingStage(sweep.stage)) {
            sweep = await pollSweep(api, sweepId);
            next = await api.nextQuestion(sweepId);
          }
          if (sweep.stage === 'failed') {
            if (alive.current) {
              setLoad({ kind: 'error', message: 'We could not finish reading your room.', failed: true });
            }
            return;
          }
        }
        if (alive.current) setLoad({ kind: 'ready', next });
      } catch (error) {
        if (alive.current) setLoad({ kind: 'error', message: describeApiError(error), failed: false });
      }
    },
    [sweepId],
  );

  useEffect(() => {
    void fetchNext(true);
  }, [fetchNext]);

  const next = load.kind === 'ready' ? load.next : null;
  const question = next?.question ?? null;
  const number = (next?.askedCount ?? 0) + 1;

  // New question: clear the drafts and tell VoiceOver what is being asked.
  const questionId = question?.id ?? null;
  useEffect(() => {
    setChoice(null);
    setMulti([]);
    setText('');
    setFieldError(null);
    setSendError(null);
    if (question !== null) {
      AccessibilityInfo.announceForAccessibility(`Question ${number}. ${question.prompt}`);
    } else if (next !== null) {
      AccessibilityInfo.announceForAccessibility("That's all the questions. You can see your quote now.");
    }
    // Only when the question itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, next !== null]);

  const send = async (q: Question, value: AnswerValue, skipped: boolean) => {
    if (sweepId === null) return;
    setSending(skipped ? 'skip' : 'answer');
    setSendError(null);
    try {
      await getApi().submitAnswers(sweepId, {
        answers: [skipped ? { questionId: q.id, field: q.field, value: null, skipped: true } : { questionId: q.id, field: q.field, value }],
      });
      Haptics.selectionAsync().catch(() => undefined);
      await fetchNext(false);
    } catch (error) {
      if (alive.current) setSendError(describeApiError(error));
    } finally {
      if (alive.current) setSending(null);
    }
  };

  /** The value to send for the current draft, or null with a field problem shown. */
  const draftValue = (q: Question): { ok: true; value: AnswerValue } | { ok: false } => {
    const options = q.options ?? [];
    switch (q.inputType) {
      case 'boolean': {
        if (choice === null) return { ok: false };
        const hit = options.find((o) => String(o.value) === choice);
        return { ok: true, value: hit ? hit.value : choice === 'true' };
      }
      case 'single_select': {
        const hit = options.find((o) => String(o.value) === choice);
        return hit ? { ok: true, value: hit.value } : { ok: false };
      }
      case 'multi_select':
        return multi.length > 0 ? { ok: true, value: multi.join(',') } : { ok: false };
      case 'number': {
        const r = readNumber(text);
        if (!r.ok) {
          setFieldError(r.problem);
          return { ok: false };
        }
        return { ok: true, value: r.value };
      }
      default: {
        const t = text.trim();
        if (t.length === 0) {
          setFieldError('Type an answer, or choose "Skip".');
          return { ok: false };
        }
        return { ok: true, value: t };
      }
    }
  };

  const hasDraft = (q: Question): boolean => {
    switch (q.inputType) {
      case 'boolean':
      case 'single_select':
        return choice !== null;
      case 'multi_select':
        return multi.length > 0;
      default:
        return text.trim().length > 0;
    }
  };

  /* ------------------------------------------------------------------------ */

  if (sweepId === null) {
    return (
      <Screen title="A few questions">
        <Notice tone="error" actionLabel="Start a new room" onAction={() => router.replace('/new')}>
          We could not find your room scan. Please start again.
        </Notice>
      </Screen>
    );
  }

  if (load.kind === 'loading') {
    return (
      <Screen title="A few questions" subtitle="Getting your next question.">
        <SkeletonCard accessibilityLabel="Loading your next question" lines={3} />
      </Screen>
    );
  }

  if (load.kind === 'error') {
    return (
      <Screen title="A few questions">
        {load.failed ? (
          <Notice tone="error" actionLabel="Scan the room again" onAction={() => router.replace('/new')}>
            {load.message}
          </Notice>
        ) : (
          <Notice tone="error" actionLabel="Try again" onAction={() => void fetchNext(true)}>
            {load.message}
          </Notice>
        )}
      </Screen>
    );
  }

  const skipped = load.next.skipped;
  const skippedPanel = (
    <SkippedCounter items={skipped} expanded={showSkipped} onToggle={() => setShowSkipped((v) => !v)} />
  );

  // Finished: nothing left worth asking.
  if (question === null) {
    return (
      <Screen
        title="That's all we need"
        subtitle="Thanks. We have enough to work out your quote."
        footer={
          <Button
            label="See my quote"
            accessibilityHint="Shows your result and your price estimate."
            onPress={() => router.replace({ pathname: '/verdict', params: { id: sweepId } })}
          />
        }
      >
        {skippedPanel}
      </Screen>
    );
  }

  const q = question;
  const options = q.options ?? [];
  const busy = sending !== null;
  const unitWord = q.unit && q.unit !== 'year' ? ` (${q.unit})` : '';

  let input: ReactNode;
  switch (q.inputType) {
    case 'boolean':
    case 'single_select': {
      const choices =
        options.length > 0
          ? options.map((o) => ({ value: String(o.value), label: o.label }))
          : [
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' },
            ];
      input = (
        <ChoiceGroup<string>
          label="Choose one answer"
          choices={choices}
          value={choice}
          onChange={(v) => {
            setChoice(v);
            setSendError(null);
          }}
          direction={q.inputType === 'boolean' && choices.length <= 2 ? 'row' : 'column'}
        />
      );
      break;
    }
    case 'multi_select':
      input = (
        <View style={{ gap: SPACE.sm }}>
          <Text variant="small" weight="semibold">
            Choose all that apply
          </Text>
          {options.map((o) => {
            const key = String(o.value);
            const checked = multi.includes(key);
            return (
              <CheckRow
                key={key}
                label={o.label}
                checked={checked}
                onPress={() => setMulti((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))}
              />
            );
          })}
        </View>
      );
      break;
    case 'number':
      input = (
        <TextField
          label={`Your answer${unitWord}`}
          accessibilityLabel={q.accessibilityLabel}
          help={q.unit === 'year' ? 'Four digits, like 1995. A best guess is fine.' : 'A number, like 2. A best guess is fine.'}
          error={fieldError}
          value={text}
          onChangeText={(v) => {
            setText(v);
            setFieldError(null);
          }}
          keyboardType={q.unit === 'year' ? 'number-pad' : 'decimal-pad'}
          returnKeyType="done"
        />
      );
      break;
    default:
      input = (
        <TextField
          label="Your answer"
          accessibilityLabel={q.accessibilityLabel}
          error={fieldError}
          value={text}
          onChangeText={(v) => {
            setText(v);
            setFieldError(null);
          }}
          multiline
          returnKeyType="done"
        />
      );
  }

  // Keeps Next / Skip above the keyboard (the number pad has no return key).
  // Offset = status bar + the iOS stack header's standard 44pt (M7-11).
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
    <Screen
      footer={
        <>
          {sendError !== null ? (
            <Notice
              tone="error"
              actionLabel="Try again"
              onAction={() => {
                const d = draftValue(q);
                if (d.ok) void send(q, d.value, false);
              }}
            >
              {sendError}
            </Notice>
          ) : null}
          <Button
            label="Next"
            loading={sending === 'answer'}
            disabled={busy || !hasDraft(q)}
            accessibilityHint={hasDraft(q) ? 'Saves your answer and shows the next question.' : 'Answer the question first, or skip it.'}
            onPress={() => {
              const d = draftValue(q);
              if (d.ok) void send(q, d.value, false);
            }}
          />
          <Button
            label="Skip — I'm not sure"
            variant="secondary"
            fullWidth
            loading={sending === 'skip'}
            disabled={busy}
            accessibilityLabel="Skip this question. I'm not sure."
            accessibilityHint="Moves on without an answer. Your quote may be less exact."
            onPress={() => void send(q, null, true)}
          />
        </>
      }
    >
      <View style={{ gap: SPACE.xs }}>
        <Text variant="small" tone="muted" accessibilityElementsHidden importantForAccessibility="no">
          {`Question ${number}`}
        </Text>
        <Heading
          variant="title"
          accessibilityLabel={`Question ${number}. ${q.prompt}`}
          accessibilityHint={q.accessibilityLabel}
        >
          {q.prompt}
        </Heading>
      </View>
      {input}
      {skippedPanel}
    </Screen>
    </KeyboardAvoidingView>
  );
}

/* -------------------------------------------------------------------------- */

/** "Questions skipped: N" — a button that expands to one reason per field. */
function SkippedCounter({
  items,
  expanded,
  onToggle,
}: {
  items: NextQuestionResponseDto['skipped'];
  expanded: boolean;
  onToggle: () => void;
}) {
  const n = items.length;
  if (n === 0) {
    return (
      <Text variant="small" tone="muted">
        Questions skipped: 0
      </Text>
    );
  }
  return (
    <Card tone="muted" padding="md">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Questions skipped: ${n}`}
        accessibilityHint={expanded ? 'Hides the reasons.' : 'Shows why we did not need to ask each one.'}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        hitSlop={4}
        style={({ pressed }) => ({
          minHeight: MIN_TOUCH_TARGET,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: SPACE.sm,
          borderRadius: RADIUS.card,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text weight="semibold">{`Questions skipped: ${n}`}</Text>
        <Text tone="muted" style={{ textDecorationLine: 'underline' }}>
          {expanded ? 'Hide why ▲' : 'Show why ▼'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={{ gap: SPACE.sm }}>
          <Text variant="small" tone="muted">
            We did not need to ask these. Here is why:
          </Text>
          {items.map((s) => {
            const name = capitalise(plainField(s.field));
            return (
              <View
                key={s.field}
                accessible
                accessibilityLabel={`${name}: ${s.reason}`}
                style={{ borderTopWidth: BORDER.width, borderTopColor: COLORS.muted, paddingTop: SPACE.sm, gap: SPACE.xs }}
              >
                <Text weight="semibold">{name}</Text>
                <Text>{s.reason}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

/** One checkbox option: a box with a check mark when chosen, never colour alone. */
function CheckRow({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE.md,
        paddingHorizontal: SPACE.lg,
        paddingVertical: SPACE.md,
        borderRadius: RADIUS.card,
        borderWidth: checked ? 2 : BORDER.width,
        borderColor: checked ? COLORS.ink : COLORS.muted,
        backgroundColor: pressed ? COLORS.mutedTint : COLORS.paper,
      })}
    >
      <Text
        weight="semibold"
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ color: checked ? COLORS.ink : COLORS.mutedDeep, minWidth: 20 }}
      >
        {checked ? '☑' : '☐'}
      </Text>
      <Text style={{ flexShrink: 1 }}>{label}</Text>
    </Pressable>
  );
}
