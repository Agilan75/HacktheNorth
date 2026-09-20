import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import * as Location from 'expo-location';

import { ArOverlay } from '@/ar/ArOverlay';
import { toDegrees, useWorldPose } from '@/ar/pose';
import { hasViro, useViroPlanes, viroCameraPosition } from '@/ar/pose.viro';
import { ViroSession } from '@/ar/ViroSession';
import type { ViroSessionHandle } from '@/ar/ViroSession';
import { getApi } from '@/lib/api';
import { captureReducer, initialCaptureState, summarize, uploadBearings } from '@/lib/capture';
import type { PendingCapture } from '@/lib/capture';
import { createLivePricer } from '@/lib/livePrice';
import type { LivePricer } from '@/lib/livePrice';
import { getSweepQueue } from '@/lib/queue';
import { SESSION_PROBLEM_TEXT, buildCreateRequest, sessionStore, useSession } from '@/lib/session';
import type { SessionFrame } from '@/lib/session';
import { Button, COLORS, MIN_TOUCH_TARGET, Notice, SPACE, Screen, Text } from '@/ui';

/**
 * The viewfinder. It is the first screen and it is the sweep: launch opens the
 * camera, the phone takes the photos as you turn, and Finish is the only tap
 * between here and a price.
 *
 * The compass heading from `watchHeadingAsync` goes through the circular filter
 * into the capture reducer, which decides when a frame is due (every ~1.2 s once
 * the heading has moved >= 10 degrees, at most 15). Each frame is downscaled to
 * a 768 px long edge, JPEG q0.7, with a haptic tick, and is priced live.
 *
 * Every item the live pricer finds feeds one number: the replacement value sent
 * with the sweep, which the server rounds into the contents limit. Nobody is
 * asked what their belongings are worth.
 *
 * The client coverage only drives the overlay and the Finish lock. The API
 * computes every number that counts.
 */

/** Long edge after downscale and JPEG quality: the prototype's encoder. */
const MAX_EDGE = 768;
const JPEG_QUALITY = 0.7;
/** Photos the upload path asks for: bearings 0/120/240. */
const UPLOAD_PHOTO_COUNT = 3;
/** No compass reading this long after subscribing means the compass is not working. */
const HEADING_WATCHDOG_MS = 6000;
/** The pose runs at 60 Hz; the capture machine is fed at 10 Hz. */
const HEADING_FEED_MS = 100;

const sweepQueue = getSweepQueue((req) => getApi().createSweep(req));

type PermissionKind = 'granted' | 'denied' | 'undetermined';

interface LocationPermission {
  readonly status: PermissionKind;
  readonly canAskAgain: boolean;
}

function toKind(status: string): PermissionKind {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

type CompassProblem = 'no-readings' | 'error';

type SendState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'picking' }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'sending'; readonly count: number }
  | { readonly kind: 'queued'; readonly message: string }
  | {
      readonly kind: 'error';
      readonly message: string;
      /** What the main button does: resend the same photos, or nothing to resend. */
      readonly next: 'resend' | 'none';
    };

/** Image data for a captured frame, keyed by the capture machine's frame index. */
interface FrameData {
  readonly imageBase64: string;
  readonly uri: string;
  readonly pitchDeg: number | undefined;
}

/** Downscales a photo to a 768 px long edge JPEG (q0.7). Also converts HEIC from the library. */
async function downscale(uri: string, width: number, height: number): Promise<{ base64: string; uri: string }> {
  const longEdge = Math.max(width, height);
  const resize =
    longEdge > MAX_EDGE ? [{ resize: width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE } }] : [];
  const out = await manipulateAsync(uri, resize, { base64: true, compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  if (!out.base64) throw new Error('no image data');
  return { base64: out.base64, uri: out.uri };
}

export default function ViewfinderScreen() {
  const router = useRouter();

  const [cameraPermission, requestCamera, refreshCamera] = useCameraPermissions();
  const [locationPermission, setLocationPermission] = useState<LocationPermission | null>(null);
  const [asked, setAsked] = useState(false);
  /** True while the system dialogs are up, so the denied view does not flash behind them. */
  const [asking, setAsking] = useState(false);
  const [compassProblem, setCompassProblem] = useState<CompassProblem | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [send, setSend] = useState<SendState>({ kind: 'idle' });

  const [capture, dispatch] = useReducer(captureReducer, initialCaptureState);
  const summary = useMemo(() => summarize(capture), [capture]);
  /**
   * A sweep from earlier in this session, if any. Only then can a pin open
   * `/hazard/[id]` on something the API has actually scored.
   */
  const priorSweepId = useSession((s) => s.sweepId);

  /**
   * True on a build that carries ViroReact. Expo Go is never it, and a session
   * that cannot start flips this back to the camera rather than failing.
   */
  const [ar, setAr] = useState(hasViro);
  const viroRef = useRef<ViroSessionHandle | null>(null);
  const planes = useViroPlanes();

  const cameraRef = useRef<CameraView>(null);
  const frameData = useRef(new Map<number, FrameData>());
  const pricerRef = useRef<LivePricer | null>(null);
  pricerRef.current ??= createLivePricer(getApi());
  const pricer = pricerRef.current;
  const liveSnap = useSyncExternalStore(pricer.subscribe, pricer.snapshot);
  const pitchRef = useRef<number | undefined>(undefined);
  const capturingRef = useRef(false);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  /* ------------------------------ permissions ----------------------------- */

  const readLocation = useCallback(async () => {
    try {
      const p = await Location.getForegroundPermissionsAsync();
      if (alive.current) setLocationPermission({ status: toKind(p.status), canAskAgain: p.canAskAgain });
    } catch {
      if (alive.current) setLocationPermission({ status: 'denied', canAskAgain: false });
    }
  }, []);

  useEffect(() => {
    void readLocation();
  }, [readLocation]);

  // Coming back from Settings: read both permissions again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void refreshCamera();
      void readLocation();
    });
    return () => sub.remove();
  }, [refreshCamera, readLocation]);

  const cameraKind: PermissionKind | null = cameraPermission ? toKind(cameraPermission.status) : null;
  const undecided = cameraKind === 'undetermined' || locationPermission?.status === 'undetermined';

  // Nothing stands between launch and the camera: the moment the permissions
  // are readable and either is undecided, the system prompt goes up by itself.
  useEffect(() => {
    if (asked || asking || cameraKind === null || locationPermission === null || !undecided) return;
    void allowAndStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, asking, cameraKind, locationPermission, undecided]);

  type Gate = 'checking' | 'camera-denied' | 'compass' | 'ready';
  const gate: Gate =
    cameraKind === null || locationPermission === null || asking || (undecided && !asked)
      ? 'checking'
      : cameraKind !== 'granted'
        ? 'camera-denied'
        : compassProblem !== null
          ? 'compass'
          : 'ready';

  async function allowAndStart(): Promise<void> {
    setAsking(true);
    try {
      if (cameraPermission?.status !== 'granted') await requestCamera();
    } catch {
      // Falls through to the camera-denied view with its own words.
    }
    try {
      if (locationPermission?.status !== 'granted') {
        const p = await Location.requestForegroundPermissionsAsync();
        if (alive.current) setLocationPermission({ status: toKind(p.status), canAskAgain: p.canAskAgain });
      }
    } catch {
      if (alive.current) setLocationPermission({ status: 'denied', canAskAgain: false });
    }
    if (alive.current) {
      setAsked(true);
      setAsking(false);
    }
  }

  async function askCameraAgain(): Promise<void> {
    if (cameraPermission && !cameraPermission.canAskAgain) {
      await Linking.openSettings().catch(() => undefined);
      return;
    }
    await requestCamera().catch(() => undefined);
  }

  async function retryCompass(): Promise<void> {
    if (locationPermission?.status !== 'granted' && locationPermission?.canAskAgain) {
      try {
        const p = await Location.requestForegroundPermissionsAsync();
        if (alive.current) setLocationPermission({ status: toKind(p.status), canAskAgain: p.canAskAgain });
      } catch {
        // The watchdog below reports it again if the compass still says nothing.
      }
    }
    setCompassProblem(null);
  }

  /* -------------------------------- sensors ------------------------------- */

  const sensing = gate === 'ready' && send.kind === 'idle' && capture.phase !== 'finished';

  /**
   * One pose for both jobs. The overlay draws with it, and the capture machine
   * is driven by it, so there is a single subscription to the compass and the
   * motion sensor rather than one each.
   */
  const pose = useWorldPose();

  // The pose publishes at 60 Hz. The capture machine only ever needed compass
  // rate, and it interpolates the panels between samples, so it is fed at 10 Hz.
  const lastFedMs = useRef(0);
  useEffect(() => {
    if (!sensing || !pose.ready) return;
    const now = Date.now();
    if (now - lastFedMs.current < HEADING_FEED_MS) return;
    lastFedMs.current = now;
    pitchRef.current = Math.round(pose.pitch * (180 / Math.PI));
    dispatch({ type: 'heading', headingDeg: toDegrees(pose.yaw), atMs: now });
  }, [sensing, pose]);

  // Neither sensor spoke: say so, and offer the photo path.
  useEffect(() => {
    if (!sensing || pose.ready) return undefined;
    const watchdog = setTimeout(() => setCompassProblem('no-readings'), HEADING_WATCHDOG_MS);
    return () => clearTimeout(watchdog);
  }, [sensing, pose.ready]);

  // Start the machine once the camera shows a picture and the pose is live.
  useEffect(() => {
    if (sensing && cameraReady && pose.ready && capture.phase === 'idle') dispatch({ type: 'start' });
  }, [sensing, cameraReady, pose.ready, capture.phase]);

  /* -------------------------------- capture ------------------------------- */

  /**
   * One frame, from whichever preview is live. An AR session hands back a
   * screenshot file; `expo-camera` hands back a photo. Both are file URIs, so
   * the rest of the capture path is the same either way.
   */
  const grab = useCallback(async (): Promise<{ uri: string; width: number; height: number }> => {
    const session = viroRef.current;
    if (session !== null) return session.takePicture();
    const cam = cameraRef.current;
    if (!cam) throw new Error('no camera');
    const pic = await cam.takePictureAsync({ quality: 0.8, shutterSound: false });
    return { uri: pic.uri, width: pic.width, height: pic.height };
  }, []);

  const takeFrame = useCallback(
    async (p: PendingCapture) => {
      if (capturingRef.current) return;
      capturingRef.current = true;
      try {
        const pic = await grab();
        const small = await downscale(pic.uri, pic.width, pic.height);
        if (!alive.current) return;
        frameData.current.set(p.index, { imageBase64: small.base64, uri: small.uri, pitchDeg: pitchRef.current });
        // The bearing is what anchors whatever is found to the room.
        pricer.onFrame(small.base64, p.bearingDeg);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        dispatch({ type: 'captured', atMs: Date.now(), ref: small.uri });
      } catch {
        if (alive.current) dispatch({ type: 'captureFailed' });
      } finally {
        capturingRef.current = false;
      }
    },
    [grab, pricer],
  );

  useEffect(() => {
    if (capture.pending && capture.phase === 'sweeping') void takeFrame(capture.pending);
  }, [capture.pending, capture.phase, takeFrame]);

  /* --------------------------------- send --------------------------------- */

  async function submitSession(): Promise<void> {
    const built = buildCreateRequest(sessionStore.getState());
    if (!built.ok) {
      setSend({
        kind: 'error',
        message: built.problems.map((p) => SESSION_PROBLEM_TEXT[p]).join(' '),
        next: 'none',
      });
      return;
    }
    setSend({ kind: 'sending', count: built.request.frames.length });
    AccessibilityInfo.announceForAccessibility(`Sending ${built.request.frames.length} photos.`);
    const result = await sweepQueue.submit(built.request);
    if (!alive.current) return;
    if (result.status === 'sent') {
      sessionStore.setSweepId(result.sweep.id);
      router.replace({ pathname: '/analyzing', params: { id: result.sweep.id } });
      return;
    }
    if (result.status === 'failed') {
      setSend({ kind: 'error', message: result.message, next: 'resend' });
      return;
    }
    setSend({ kind: 'queued', message: result.message });
    AccessibilityInfo.announceForAccessibility(result.message);
    sweepQueue
      .waitFor(result.queueId)
      .then((sweep) => {
        sessionStore.setSweepId(sweep.id);
        if (alive.current) router.replace({ pathname: '/analyzing', params: { id: sweep.id } });
      })
      .catch(() => {
        if (alive.current) {
          setSend({ kind: 'error', message: 'The scan did not send. Try again.', next: 'resend' });
        }
      });
  }

  /**
   * Finish is the only tap between launch and a price, so it goes straight to
   * the upload. The running total is taken as it stands rather than waiting on
   * the last online lookups: those take up to 5 s, and the contents figure is
   * editable on the verdict anyway.
   */
  function finishSweep(): void {
    const frames: SessionFrame[] = [];
    for (const f of capture.frames) {
      const data = frameData.current.get(f.index);
      if (!data) continue;
      frames.push({
        bearingDeg: f.bearingDeg,
        ...(data.pitchDeg !== undefined ? { pitchDeg: data.pitchDeg } : {}),
        capturedAt: new Date(f.capturedAtMs).toISOString(),
        imageBase64: data.imageBase64,
        uri: data.uri,
      });
    }
    dispatch({ type: 'finish' });
    setCameraReady(false);
    sessionStore.setSweepId(null);
    sessionStore.setFrames(frames, 'sweep');
    sessionStore.setContentsEstimate(pricer.snapshot().total);
    void submitSession();
  }

  function scanAgain(): void {
    pricer.reset();
    frameData.current.clear();
    sessionStore.clearFrames();
    sessionStore.setSweepId(null);
    setCompassProblem(null);
    setCameraReady(false);
    dispatch({ type: 'reset' });
    setSend({ kind: 'idle' });
  }

  /** The upload path: pick up to 3 library photos, spaced at 0/120/240. */
  async function usePhotos(): Promise<void> {
    if (send.kind !== 'idle' && send.kind !== 'error') return;
    setSend({ kind: 'picking' });
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: UPLOAD_PHOTO_COUNT,
        orderedSelection: true,
        quality: 1,
      });
    } catch {
      if (alive.current) setSend({ kind: 'error', message: 'The photo library did not open.', next: 'none' });
      return;
    }
    if (!alive.current) return;
    if (picked.canceled || picked.assets.length === 0) {
      setSend({ kind: 'idle' });
      return;
    }
    setSend({ kind: 'preparing' });
    const assets = picked.assets.slice(0, UPLOAD_PHOTO_COUNT);
    const bearings = uploadBearings(assets.length);
    let frames: SessionFrame[];
    try {
      frames = await Promise.all(
        assets.map(async (a, i) => {
          const small = await downscale(a.uri, a.width, a.height);
          return {
            bearingDeg: bearings[i] ?? 0,
            capturedAt: new Date().toISOString(),
            imageBase64: small.base64,
            uri: small.uri,
          };
        }),
      );
    } catch {
      if (alive.current) setSend({ kind: 'error', message: 'One photo could not be read. Pick another.', next: 'none' });
      return;
    }
    if (!alive.current) return;
    dispatch({ type: 'reset' });
    frameData.current.clear();
    sessionStore.setSweepId(null);
    sessionStore.setFrames(frames, 'upload');
    sessionStore.setContentsEstimate(null);
    await submitSession();
  }

  /* -------------------------------- render -------------------------------- */

  /** A text link, not a button: the camera is the path, photos are the alternative. */
  const photoLink = (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Upload photos instead"
      accessibilityHint="Pick three photos of the room. Same quote."
      onPress={() => void usePhotos()}
      hitSlop={8}
      style={styles.link}
    >
      <Text variant="small" tone="inverse" style={styles.linkText}>
        Upload photos instead
      </Text>
    </Pressable>
  );

  if (send.kind !== 'idle') {
    return (
      <SendView
        send={send}
        onRetry={() => void submitSession()}
        onRetryNow={() => void sweepQueue.retryNow()}
        onScanAgain={scanAgain}
        onUsePhotos={() => void usePhotos()}
      />
    );
  }

  if (gate === 'checking') {
    return (
      <Screen>
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Opening the camera" style={styles.center}>
          <ActivityIndicator color={COLORS.ink} />
          <Text align="center">Opening the camera</Text>
        </View>
      </Screen>
    );
  }

  if (gate === 'camera-denied') {
    const settings = cameraPermission !== null && !cameraPermission.canAskAgain;
    return (
      <Screen
        title="Camera off"
        footer={
          <>
            <Button label="Upload 3 photos instead" icon="images-outline" onPress={() => void usePhotos()} />
            <Button
              label={settings ? 'Open Settings' : 'Allow the camera'}
              icon={settings ? 'settings-outline' : 'camera-outline'}
              variant="secondary"
              accessibilityHint={settings ? 'Turn on Camera, then come back.' : 'Asks for camera access.'}
              onPress={() => void askCameraAgain()}
            />
          </>
        }
      >
        <Text>{settings ? 'Camera access is off for this app.' : 'Camera access was not allowed.'}</Text>
        <Text>Three photos of the room give the same quote.</Text>
      </Screen>
    );
  }

  if (gate === 'compass') {
    const locationOff = locationPermission?.status === 'denied';
    return (
      <Screen
        title="No compass"
        footer={
          <>
            <Button label="Upload 3 photos instead" icon="images-outline" onPress={() => void usePhotos()} />
            {locationOff && locationPermission && !locationPermission.canAskAgain ? (
              <Button
                label="Open Settings"
                icon="settings-outline"
                variant="secondary"
                accessibilityHint="Turn on Location, then come back."
                onPress={() => void Linking.openSettings().catch(() => undefined)}
              />
            ) : null}
            <Button label="Try again" icon="refresh-outline" variant="secondary" onPress={() => void retryCompass()} />
          </>
        }
      >
        <Text>
          {locationOff
            ? 'Location access is off, and the phone reads the compass through it. Direction only. Never stored.'
            : 'The compass did not answer. Metal nearby can do this. Step away, or wave the phone in a figure 8.'}
        </Text>
        <Text>Three photos of the room give the same quote.</Text>
      </Screen>
    );
  }

  return (
    <View style={styles.camera} accessibilityLabel="Room scan">
      <StatusBar style="light" />
      {ar ? (
        <ViroSession
          onReady={(handle) => {
            viroRef.current = handle;
            setCameraReady(true);
          }}
          onUnavailable={() => {
            // The AR session could not start. The camera and the sensors can.
            viroRef.current = null;
            setAr(false);
          }}
        />
      ) : (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          animateShutter={false}
          onCameraReady={() => setCameraReady(true)}
          onMountError={() =>
            setSend({ kind: 'error', message: 'The camera did not start.', next: 'none' })
          }
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
      <ArOverlay
        pose={pose}
        panels={capture.panels}
        coveragePct={summary.coveragePctDisplay}
        canFinish={summary.canFinish}
        onFinish={finishSweep}
        live={liveSnap}
        planes={planes}
        camera={viroCameraPosition()}
        {...(priorSweepId !== null
          ? {
              onHazard: (hazardKey: string) =>
                router.push({ pathname: '/hazard/[id]', params: { id: hazardKey, sweep: priorSweepId } }),
            }
          : {})}
        footer={photoLink}
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* After Finish: sending, queued, or a problem                                */
/* -------------------------------------------------------------------------- */

function SendView({
  send,
  onRetry,
  onRetryNow,
  onScanAgain,
  onUsePhotos,
}: {
  readonly send: Exclude<SendState, { kind: 'idle' }>;
  readonly onRetry: () => void;
  readonly onRetryNow: () => void;
  readonly onScanAgain: () => void;
  readonly onUsePhotos: () => void;
}) {
  if (send.kind === 'picking' || send.kind === 'preparing' || send.kind === 'sending') {
    const words =
      send.kind === 'picking'
        ? 'Opening your photos'
        : send.kind === 'preparing'
          ? 'Preparing photos'
          : `Sending ${send.count} ${send.count === 1 ? 'photo' : 'photos'}`;
    return (
      <Screen>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={words}
          accessibilityState={{ busy: true }}
          style={styles.center}
        >
          <ActivityIndicator color={COLORS.ink} size="large" />
          <Text align="center">{words}</Text>
        </View>
      </Screen>
    );
  }

  if (send.kind === 'queued') {
    return (
      <Screen title="No connection">
        <Notice tone="info">{send.message}</Notice>
        <Text tone="muted">Photos are held on this phone. Sending resumes by itself.</Text>
        <Button label="Send now" variant="secondary" onPress={onRetryNow} />
        <Button label="Scan again" variant="secondary" onPress={onScanAgain} />
      </Screen>
    );
  }

  return (
    <Screen title="Not sent">
      <Notice tone="error">{send.message}</Notice>
      {send.next === 'resend' ? (
        <Button label="Try again" accessibilityHint="Sends the same photos again." onPress={onRetry} />
      ) : null}
      <Button label="Scan again" variant="secondary" onPress={onScanAgain} />
      <Button label="Upload 3 photos instead" variant="secondary" onPress={onUsePhotos} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  overlay: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.md,
  },
  link: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    textDecorationLine: 'underline',
  },
});
