import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { SweepDto, SweepStageDto } from '@retrofit/contracts';

import { describeApiError, getApi } from '@/lib/api';
import { getSweepQueue, queueStatusMessage } from '@/lib/queue';
import type { QueueSnapshot } from '@/lib/queue';
import { isTermMonths, sessionStore } from '@/lib/session';
import type { FrameSource } from '@/lib/session';
import {
  Badge,
  Brand,
  Button,
  COLORS,
  Card,
  Heading,
  Hero,
  Icon,
  MIN_TOUCH_TARGET,
  Notice,
  Screen,
  SkeletonCard,
  SPACE,
  Text,
  VerdictPill,
} from '@/ui';
import type { IconName } from '@/ui';

/**
 * Your rooms — PRD §11 `/`. Unit M5.
 *
 * The API has no "list my sweeps" route, so the rooms list is the rooms this
 * app sent during this launch (decision M5-1): every time the session store
 * gains a sweep id, the room is recorded here. Each card then loads the sweep
 * from GET /sweeps/:id and shows a skeleton until it arrives. Everything the
 * card says about the result (stage, verdict) comes from the API as-is.
 */

/* -------------------------------------------------------------------------- */
/* Rooms registry (module scope, in memory)                                   */
/* -------------------------------------------------------------------------- */

interface RoomEntry {
  readonly sweepId: string;
  readonly roomLabel: string;
  readonly termMonths: number;
  readonly source: FrameSource | null;
}

let rooms: readonly RoomEntry[] = [];
const roomListeners = new Set<() => void>();

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

const STAGE_WORDS: Readonly<Record<SweepStageDto, string>> = {
  received: 'Photos received',
  quality_gate: 'Checking photo quality',
  observing: 'Looking at the room',
  relating: 'Working out what matters',
  scoring: 'Working out your quote',
  questions: 'Waiting for your answers',
  done: 'Quote ready',
  failed: 'Could not finish',
};

/** Decorative only — `STAGE_WORDS` still carries the meaning in every card. */
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

const TENANT_VERDICT: Readonly<Record<'FIT' | 'REFER' | 'DOES_NOT_FIT', string>> = {
  FIT: 'We can quote this room',
  REFER: 'A person needs to check this',
  DOES_NOT_FIT: 'We cannot quote this as it is',
};

function termWords(months: number): string {
  return `${months}-month term`;
}

const sendSweep = getSweepQueue((req) => getApi().createSweep(req));

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

  const open = useCallback(
    (stage: SweepStageDto | null) => {
      sessionStore.reset();
      sessionStore.setRoomLabel(entry.roomLabel);
      if (isTermMonths(entry.termMonths)) sessionStore.setTerm(entry.termMonths);
      sessionStore.setSweepId(entry.sweepId);
      router.push(stage === 'done' ? '/verdict' : '/analyzing');
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
  const a11y = [label, stageText, verdictText, termWords(sweep.termMonths), how].filter(Boolean).join('. ');

  return (
    <Card
      onPress={() => open(sweep.stage)}
      accessibilityLabel={a11y}
      accessibilityHint={sweep.stage === 'done' ? 'Opens your quote.' : 'Opens this room to carry on.'}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.sm }}>
        <Heading variant="heading" style={{ flexShrink: 1 }}>
          {label}
        </Heading>
        <Icon name={STAGE_ICON[sweep.stage]} size={22} color={COLORS.mutedDeep} />
      </View>
      <Text tone="muted">{termWords(sweep.termMonths)}</Text>
      {verdict && verdictText ? (
        <VerdictPill verdict={verdict} text={verdictText} />
      ) : (
        <Badge
          label={stageText}
          tone={sweep.stage === 'failed' ? 'attention' : 'info'}
          icon={STAGE_ICON[sweep.stage]}
        />
      )}
      <Text variant="small" tone="muted">
        {how}
      </Text>
      <Text variant="small" weight="semibold" style={{ alignSelf: 'flex-end' }}>
        {sweep.stage === 'done' ? 'See quote ›' : 'Carry on ›'}
      </Text>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export default function RoomsScreen() {
  const router = useRouter();
  const list = useSyncExternalStore(subscribeRooms, getRooms, getRooms);
  const [queueSnap, setQueueSnap] = useState<QueueSnapshot>(() => sendSweep.getSnapshot());
  const [refreshKey, setRefreshKey] = useState(0);
  const firstFocus = useRef(true);

  useEffect(() => sendSweep.subscribe(setQueueSnap), []);

  // A queued sweep gets another go as soon as the app comes back to the front.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void sendSweep.retryNow();
    });
    return () => sub.remove();
  }, []);

  // Coming back to this screen reloads each room's stage.
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

  return (
    <Screen
      footer={
        <Button
          label="New sweep"
          icon="add-circle"
          accessibilityHint="Starts a new room. You can scan with the camera or upload photos."
          onPress={() => {
            sessionStore.reset();
            router.push('/new');
          }}
        />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <Brand size={32} showWordmark={false} />
        <Heading accessibilityRole="header">Your rooms</Heading>
      </View>
      <Text tone="muted">
        Scan a room with your camera, or upload three photos, and get a renter&apos;s insurance quote without
        a long form.
      </Text>

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

      {list.length === 0 ? (
        <Hero tone="blue" accessibilityLabel="No rooms yet. Tap New sweep to start.">
          <Text tone="inverse" variant="heading" weight="semibold">
            No rooms yet
          </Text>
          <Text tone="inverse">
            Tap New sweep to start. It takes about a minute: name the room, then either turn slowly with your
            camera or pick three photos.
          </Text>
          <View style={{ flexDirection: 'row', gap: SPACE.lg, marginTop: SPACE.sm }}>
            <HowStep icon="camera-outline" label="Show us the room" />
            <HowStep icon="search-outline" label="We check for risks" />
            <HowStep icon="pricetag-outline" label="Get your quote" />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="How it works"
            accessibilityHint="Opens the About screen."
            hitSlop={8}
            onPress={() => router.push('/about')}
            style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginTop: SPACE.xs }}
          >
            <Text tone="inverse" weight="semibold" style={{ textDecorationLine: 'underline' }}>
              How it works
            </Text>
          </Pressable>
        </Hero>
      ) : (
        <View style={{ gap: SPACE.md }} accessibilityRole="list" accessibilityLabel={`${list.length} rooms`}>
          {list.map((entry) => (
            <RoomCard key={entry.sweepId} entry={entry} refreshKey={refreshKey} />
          ))}
        </View>
      )}

      {list.length > 0 ? (
        <Text variant="small" tone="muted">
          Rooms are kept until you close the app.
        </Text>
      ) : null}
    </Screen>
  );
}

/** One icon + word in the empty-state "how it works" strip. Decorative: the Hero's own accessibilityLabel already says what matters. */
function HowStep({ icon, label }: { readonly icon: IconName; readonly label: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flex: 1, alignItems: 'center', gap: SPACE.xs }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: 'rgba(250,248,242,0.18)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={20} color={COLORS.paper} />
      </View>
      <Text tone="inverse" variant="micro" align="center">
        {label}
      </Text>
    </View>
  );
}
