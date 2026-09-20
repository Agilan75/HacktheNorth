import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type { SweepDto, SweepStageDto } from '@retrofit/contracts';

import { describeApiError, getApi } from '@/lib/api';
import { getSweepQueue, queueStatusMessage } from '@/lib/queue';
import type { QueueSnapshot } from '@/lib/queue';
import { ROOM_LABEL_MAX, SESSION_PROBLEM_TEXT, TERM_OPTIONS, sessionStore } from '@/lib/session';
import type { FrameSource, TermMonths } from '@/lib/session';
import {
  Brand,
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
import type { Choice, IconName } from '@/ui';

/**
 * Home. The first screen the app opens, and the only one that names a room.
 *
 * It is both the landing page and the new-quote form: the room name and the
 * term are taken here, then `/scan` is pushed with the camera. That one extra
 * tap buys back three things the viewfinder-first flow had given away — the
 * room is named rather than defaulted to 'Room', the OS permission dialog
 * arrives after the user asked to scan instead of on launch, and the camera
 * and the 60 Hz motion listener no longer start at app launch.
 *
 * Under the form sits every room this launch has sent. There is no route that
 * lists sweeps (`packages/contracts` has createSweep and getSweep, no index),
 * so the list is a module-scope registry fed by the session store, and each
 * card loads its own sweep from GET /sweeps/:id. Nothing here is persisted:
 * closing the app empties it, which is what the last line on screen says.
 *
 * This screen does no arithmetic. It shows the stage and the verdict the API
 * returned and never a price — `money()` is private to the verdict screen and
 * duplicating it here would be a second source of truth for a dollar figure.
 */

const sendSweep = getSweepQueue((req) => getApi().createSweep(req));

/* -------------------------------------------------------------------------- */
/* Rooms registry (module scope, in memory, this launch only)                 */
/* -------------------------------------------------------------------------- */

interface RoomEntry {
  readonly sweepId: string;
  readonly roomLabel: string;
  readonly termMonths: TermMonths;
  readonly source: FrameSource | null;
}

let rooms: readonly RoomEntry[] = [];
const roomListeners = new Set<() => void>();

/**
 * Records the session's sweep the moment it gains an id. `/scan` sets that id
 * with no `alive` guard, so a sweep that lands after the camera unmounted —
 * the offline-queued one — still registers itself here.
 *
 * It reads `source` before the camera clears the frames, because setting the
 * id is what fires this, and the first write wins: a second call for an id
 * already listed returns at the guard.
 */
function recordFromSession(): void {
  const s = sessionStore.getState();
  if (s.sweepId === null || rooms.some((r) => r.sweepId === s.sweepId)) return;
  rooms = [
    { sweepId: s.sweepId, roomLabel: s.roomLabel.trim(), termMonths: s.termMonths, source: s.source },
    ...rooms,
  ];
  for (const l of [...roomListeners]) l();
}

recordFromSession();
sessionStore.subscribe(recordFromSession);

function subscribeRooms(listener: () => void): () => void {
  roomListeners.add(listener);
  return () => {
    roomListeners.delete(listener);
  };
}

const getRooms = (): readonly RoomEntry[] => rooms;

/* -------------------------------------------------------------------------- */
/* Words                                                                      */
/* -------------------------------------------------------------------------- */

const TERM_CHOICES: readonly Choice<TermMonths>[] = TERM_OPTIONS.map((t) => ({
  value: t,
  label: `${String(t)} months`,
  accessibilityLabel: `${String(t)} months`,
}));

/** The same vocabulary `/analyzing` uses, so one sweep never has two names. */
const STAGE_WORDS: Readonly<Record<SweepStageDto, string>> = {
  received: 'Photos received',
  quality_gate: 'Checking sharpness',
  observing: 'Reading the room',
  relating: 'Checking risks',
  scoring: 'Pricing',
  questions: 'Waiting on you',
  done: 'Quote ready',
  failed: 'Stopped',
};

/** Decorative only — `STAGE_WORDS` carries the meaning in every card. */
const STAGE_ICON: Readonly<Record<SweepStageDto, IconName>> = {
  received: 'cloud-upload-outline',
  quality_gate: 'checkmark-done-outline',
  observing: 'eye-outline',
  relating: 'git-network-outline',
  scoring: 'calculator-outline',
  questions: 'help-circle-outline',
  done: 'checkmark-circle',
  failed: 'alert-circle-outline',
};

/** The verdict screen's own wording, so a room is described the same way twice. */
const TENANT_VERDICT: Readonly<Record<'FIT' | 'REFER' | 'DOES_NOT_FIT', string>> = {
  FIT: 'Coverable',
  REFER: 'Needs review',
  DOES_NOT_FIT: 'Not coverable',
};

function termWords(months: number): string {
  return `${String(months)}-month term`;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export default function HomeScreen() {
  const router = useRouter();
  const list = useSyncExternalStore(subscribeRooms, getRooms, getRooms);

  /**
   * The form is local state, never `useSession`. `sessionStore.reset()` runs on
   * the way into a scan, and a field bound to the store would blank itself
   * mid-typing.
   */
  const [name, setName] = useState('');
  const [term, setTerm] = useState<TermMonths>(() => sessionStore.getState().termMonths);
  const [nameError, setNameError] = useState<string | null>(null);

  const [queueSnap, setQueueSnap] = useState<QueueSnapshot>(() => sendSweep.getSnapshot());
  const [refreshKey, setRefreshKey] = useState(0);
  const firstFocus = useRef(true);

  useEffect(() => sendSweep.subscribe(setQueueSnap), []);

  // A queued sweep gets another go as soon as the app comes back to the front.
  // Home is the only screen that outlives a scan, so this listener lives here.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void sendSweep.retryNow();
    });
    return () => sub.remove();
  }, []);

  /**
   * Reads the compass permission once, without asking for it. `/scan` paints
   * 'Opening the camera' until both permissions are readable; warming the slow
   * one here means that spinner does not flash on every room after the first.
   * The camera permission is deliberately not warmed: requesting it is what
   * raises the OS dialog, and keeping that off the launch path is half the
   * point of this screen.
   */
  useEffect(() => {
    void Location.getForegroundPermissionsAsync().catch(() => undefined);
  }, []);

  // Coming back from a quote reloads every card's stage.
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setRefreshKey((n) => n + 1);
    }, []),
  );

  const queueLine = queueStatusMessage(queueSnap);

  /**
   * The one action. Order matters: `reset()` clears the room name and the term
   * along with the last sweep, so both are written back after it, never before.
   *
   * Resetting is also what stops the last room's hazard pins being tappable
   * over this room's camera — the viewfinder reads `sweepId` on mount to decide
   * that, and a stale id would anchor room 1's findings to room 2's walls.
   *
   * The name is left in the field on purpose. Backing out of the camera is
   * common — a denied permission, the wrong room — and clearing it would empty
   * the input while the store still held the label.
   */
  function startQuote(): void {
    const label = name.trim();
    if (label.length > ROOM_LABEL_MAX) {
      setNameError(SESSION_PROBLEM_TEXT['room-label-too-long']);
      return;
    }
    setNameError(null);
    sessionStore.reset();
    sessionStore.setRoomLabel(label);
    sessionStore.setTerm(term);
    router.push('/scan');
  }

  return (
    <Screen
      edges={['top', 'bottom', 'left', 'right']}
      footer={
        <Button
          label="Scan the room"
          icon="camera-outline"
          accessibilityHint="Opens the camera. Turn slowly in a circle until the ring is full."
          onPress={startQuote}
        />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <Brand size={32} showWordmark={false} />
        <Heading>Retrofit</Heading>
      </View>

      <Text tone="muted">Scan a room and get a tenant insurance quote. It takes about a minute.</Text>

      {queueLine ? (
        <Notice
          tone={queueSnap.pendingCount > 0 ? 'info' : 'error'}
          {...(queueSnap.pendingCount > 0
            ? { actionLabel: 'Try sending now', onAction: () => void sendSweep.retryNow() }
            : {})}
        >
          {queueLine}
        </Notice>
      ) : null}

      <Card tone="accent">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
          <Icon name="add-circle-outline" size={18} color={COLORS.ink} />
          <Heading variant="heading">New quote</Heading>
        </View>

        <TextField
          label="Room name"
          help={'Optional. For example "Kitchen" or "Bedroom".'}
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (nameError !== null) setNameError(null);
          }}
          error={nameError}
          maxLength={ROOM_LABEL_MAX}
          autoCapitalize="sentences"
          autoCorrect={false}
          returnKeyType="done"
        />

        <ChoiceGroup<TermMonths>
          label="How long do you want to be covered?"
          choices={TERM_CHOICES}
          value={term}
          onChange={setTerm}
          direction="row"
        />

        <Text variant="small" tone="muted">
          Stand in the middle of the room and turn slowly all the way around. The camera screen can take
          three photos from your library instead.
        </Text>
      </Card>

      {list.length > 0 ? (
        <View style={{ gap: SPACE.md }}>
          <Heading variant="heading">Your rooms</Heading>
          <View
            accessibilityRole="list"
            accessibilityLabel={`${String(list.length)} ${list.length === 1 ? 'room' : 'rooms'}`}
            style={{ gap: SPACE.md }}
          >
            {list.map((entry) => (
              <RoomCard key={entry.sweepId} entry={entry} refreshKey={refreshKey} />
            ))}
          </View>
          <Text variant="small" tone="muted">
            Rooms are kept until you close the app.
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Room card                                                                  */
/* -------------------------------------------------------------------------- */

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly sweep: SweepDto }
  | { readonly kind: 'error'; readonly message: string };

function RoomCard({ entry, refreshKey }: { readonly entry: RoomEntry; readonly refreshKey: number }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getApi()
      .getSweep(entry.sweepId, { signal: controller.signal })
      .then((sweep) => setLoad({ kind: 'ok', sweep }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: describeApiError(error) });
      });
    return () => controller.abort();
  }, [entry.sweepId, refreshKey, retry]);

  /**
   * Opens the room. The id travels as a param as well as through the store, so
   * the target never has to fall back to the session.
   */
  const open = useCallback(
    (stage: SweepStageDto) => {
      sessionStore.reset();
      sessionStore.setRoomLabel(entry.roomLabel);
      sessionStore.setTerm(entry.termMonths);
      sessionStore.setSweepId(entry.sweepId);
      router.push(
        stage === 'done'
          ? { pathname: '/verdict', params: { id: entry.sweepId } }
          : { pathname: '/analyzing', params: { id: entry.sweepId } },
      );
    },
    [entry, router],
  );

  if (load.kind === 'loading') {
    return <SkeletonCard accessibilityLabel={`Loading ${entry.roomLabel || 'room'}`} />;
  }

  if (load.kind === 'error') {
    return (
      <Card>
        <Heading variant="heading">{entry.roomLabel || 'Room'}</Heading>
        <Notice
          tone="error"
          actionLabel="Try again"
          onAction={() => {
            setLoad({ kind: 'loading' });
            setRetry((n) => n + 1);
          }}
        >
          {load.message}
        </Notice>
      </Card>
    );
  }

  const { sweep } = load;
  const label = sweep.roomLabel || entry.roomLabel || 'Room';
  const stageText = STAGE_WORDS[sweep.stage];
  const verdict = sweep.result?.verdict.verdict ?? null;
  const verdictText = verdict ? TENANT_VERDICT[verdict] : null;
  const how = entry.source === 'upload' ? 'From uploaded photos' : 'From a room scan';
  const a11y = [label, verdictText ?? stageText, termWords(sweep.termMonths), how]
    .filter(Boolean)
    .join('. ');

  return (
    <Card
      onPress={() => open(sweep.stage)}
      accessibilityLabel={`${a11y}.`}
      accessibilityHint={sweep.stage === 'done' ? 'Opens your quote.' : 'Opens this room to carry on.'}
    >
      <View
        style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.sm }}
      >
        <Heading variant="heading" style={{ flexShrink: 1 }}>
          {label}
        </Heading>
        <Icon name={STAGE_ICON[sweep.stage]} size={22} color={COLORS.mute} />
      </View>
      {verdict && verdictText ? (
        <VerdictPill verdict={verdict} text={verdictText} />
      ) : (
        <Text weight="semibold">{stageText}</Text>
      )}
      <Text variant="small" tone="muted">{`${termWords(sweep.termMonths)} · ${how}`}</Text>
      <Text variant="small" weight="semibold" style={{ alignSelf: 'flex-end' }}>
        {sweep.stage === 'done' ? 'See quote ›' : 'Carry on ›'}
      </Text>
    </Card>
  );
}
