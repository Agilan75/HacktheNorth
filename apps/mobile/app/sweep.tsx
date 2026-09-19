import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';

import { getApi } from '@/lib/api';
import { captureReducer, initialCaptureState, uploadBearings } from '@/lib/capture';
import type { PendingCapture } from '@/lib/capture';
import { createHeadingFilter, headingFromReading } from '@/lib/heading';
import { getSweepQueue } from '@/lib/queue';
import { SESSION_PROBLEM_TEXT, buildCreateRequest, sessionStore, useSession } from '@/lib/session';
import type { SessionFrame } from '@/lib/session';
import { Button, COLORS, Notice, Screen, SPACE, Text } from '@/ui';
import { ScanOverlay } from '@/ui/ScanOverlay';

/**
 * Scanning the room — PRD §11 `/sweep`. Unit M6.
 *
 * Camera preview under M4's ScanOverlay (the 2D Skia ring; the 3D dome is cut,
 * DECISIONS R3-2). The compass heading from `watchHeadingAsync` goes through
 * M2's circular filter into M2's capture reducer, which decides when a frame is
 * due (every ~1.2 s once the heading moved >= 10°, at most 15). Each frame is
 * downscaled to a 768 px long edge, JPEG q0.7 (the prototype's encoder), with a
 * haptic tick. Finish unlocks at >= 75% coverage and sends the sweep through
 * M1's offline queue, then hands over to /analyzing.
 *
 * If the camera or the compass is refused or not working, the screen says so in
 * plain words and offers the photo-upload path as a full alternative. The photo
 * choice is also on screen for the whole scan (PRD §11 inclusivity).
 *
 * The client coverage only drives the ring and the Finish lock. The API
 * computes every number that counts.
 */

/** Long edge after downscale and JPEG quality: the prototype's encoder (prototype/capture.js). */
const MAX_EDGE = 768;
const JPEG_QUALITY = 0.7;
/** Photos the upload path asks for (PRD §11: 3 photos at 0/120/240). */
const UPLOAD_PHOTO_COUNT = 3;
/** No compass reading this long after subscribing = the compass is not working. */
const HEADING_WATCHDOG_MS = 6000;
const MOTION_INTERVAL_MS = 200;

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
      /** What the main button does: resend the same photos, go name the room, or nothing to resend. */
      readonly next: 'resend' | 'name' | 'none';
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

export default function SweepScreen() {
  const router = useRouter();
  const roomLabel = useSession((s) => s.roomLabel);

  const [cameraPermission, requestCamera, refreshCamera] = useCameraPermissions();
  const [locationPermission, setLocationPermission] = useState<LocationPermission | null>(null);
  const [asked, setAsked] = useState(false);
  /** True while the system permission dialogs are up, so the denied view does not flash behind them. */
  const [asking, setAsking] = useState(false);
  const [compassProblem, setCompassProblem] = useState<CompassProblem | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [headingLive, setHeadingLive] = useState(false);
  const [send, setSend] = useState<SendState>({ kind: 'idle' });

  const [capture, dispatch] = useReducer(captureReducer, initialCaptureState);

  const cameraRef = useRef<CameraView>(null);
  const filterRef = useRef(createHeadingFilter());
  const frameData = useRef(new Map<number, FrameData>());
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
  const needsPrimer =
    !asked && (cameraKind === 'undetermined' || locationPermission?.status === 'undetermined');

  type Gate = 'checking' | 'primer' | 'camera-denied' | 'compass' | 'ready';
  const gate: Gate =
    cameraKind === null || locationPermission === null || asking
      ? 'checking'
      : needsPrimer
        ? 'primer'
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

  // Compass: watchHeadingAsync -> M2's filter -> the capture machine.
  useEffect(() => {
    if (!sensing) return undefined;
    let cancelled = false;
    let gotReading = false;
    let sub: Location.LocationSubscription | null = null;
    filterRef.current.reset();

    const watchdog = setTimeout(() => {
      if (!cancelled && !gotReading) setCompassProblem('no-readings');
    }, HEADING_WATCHDOG_MS);

    Location.watchHeadingAsync(
      (reading) => {
        if (cancelled) return;
        const raw = headingFromReading(reading);
        if (raw === null) return;
        const filtered = filterRef.current.push(raw);
        if (filtered === null) return;
        if (!gotReading) {
          gotReading = true;
          setHeadingLive(true);
        }
        dispatch({ type: 'heading', headingDeg: filtered, atMs: Date.now() });
      },
      () => {
        if (!cancelled && !gotReading) setCompassProblem('error');
      },
    )
      .then((s) => {
        if (cancelled) s.remove();
        else sub = s;
      })
      .catch(() => {
        if (!cancelled) setCompassProblem('error');
      });

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      sub?.remove();
      setHeadingLive(false);
    };
  }, [sensing]);

  // Pitch from DeviceMotion. Optional: without it frames simply carry no pitch.
  useEffect(() => {
    if (!sensing) return undefined;
    let sub: { remove(): void } | null = null;
    try {
      DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
      sub = DeviceMotion.addListener((m) => {
        const beta = m.rotation?.beta;
        // beta = 90° held upright; 0° flat on its back (camera facing the floor).
        if (typeof beta === 'number' && Number.isFinite(beta)) {
          pitchRef.current = Math.round((beta * 180) / Math.PI - 90);
        }
      });
    } catch {
      sub = null;
    }
    return () => sub?.remove();
  }, [sensing]);

  // Start the machine once the camera shows a picture and the compass speaks.
  useEffect(() => {
    if (sensing && cameraReady && headingLive && capture.phase === 'idle') dispatch({ type: 'start' });
  }, [sensing, cameraReady, headingLive, capture.phase]);

  /* -------------------------------- capture ------------------------------- */

  const takeFrame = useCallback(async (p: PendingCapture) => {
    const cam = cameraRef.current;
    if (!cam || capturingRef.current) return;
    capturingRef.current = true;
    try {
      const pic = await cam.takePictureAsync({ quality: 0.8, shutterSound: false });
      const small = await downscale(pic.uri, pic.width, pic.height);
      if (!alive.current) return;
      frameData.current.set(p.index, { imageBase64: small.base64, uri: small.uri, pitchDeg: pitchRef.current });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      dispatch({ type: 'captured', atMs: Date.now(), ref: small.uri });
    } catch {
      if (alive.current) dispatch({ type: 'captureFailed' });
    } finally {
      capturingRef.current = false;
    }
  }, []);

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
        next:
          built.problems.includes('room-label-missing') || built.problems.includes('room-label-too-long')
            ? 'name'
            : 'none',
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
          setSend({ kind: 'error', message: 'Your scan could not be sent. Please try again.', next: 'resend' });
        }
      });
  }

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
    void submitSession();
  }

  function scanAgain(): void {
    frameData.current.clear();
    sessionStore.clearFrames();
    sessionStore.setSweepId(null);
    setCompassProblem(null);
    setCameraReady(false);
    dispatch({ type: 'reset' });
    setSend({ kind: 'idle' });
  }

  /** The photo-upload path: pick up to 3 library photos, spaced at 0/120/240. */
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
      if (alive.current) {
        setSend({ kind: 'error', message: 'Your photo library could not be opened. Please try again.', next: 'none' });
      }
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
      if (alive.current) {
        setSend({ kind: 'error', message: 'One of those photos could not be read. Please pick different photos.', next: 'none' });
      }
      return;
    }
    if (!alive.current) return;
    dispatch({ type: 'reset' });
    frameData.current.clear();
    sessionStore.setSweepId(null);
    sessionStore.setFrames(frames, 'upload');
    await submitSession();
  }

  /* -------------------------------- render -------------------------------- */

  const photoAlternative = (primary: boolean) => (
    <Button
      label="Use 3 photos instead"
      icon="images-outline"
      variant={primary ? 'primary' : 'secondary'}
      fullWidth
      accessibilityHint="Pick three photos of the room from your library. You get the same kind of quote."
      onPress={() => void usePhotos()}
    />
  );

  if (roomLabel.trim().length === 0 && send.kind === 'idle') {
    return (
      <Screen title="Name the room first" subtitle="We need a name for the room before you scan it.">
        <Notice tone="info">{SESSION_PROBLEM_TEXT['room-label-missing']}</Notice>
        <Button label="Go back and name the room" onPress={() => router.replace('/new')} />
      </Screen>
    );
  }

  if (send.kind !== 'idle') {
    return <SendView send={send} onRetry={() => void submitSession()} onRetryNow={() => void sweepQueue.retryNow()}
      onScanAgain={scanAgain} onName={() => router.replace('/new')} photoAlternative={photoAlternative(false)} />;
  }

  if (gate === 'checking') {
    return (
      <Screen>
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Getting the camera ready" style={styles.center}>
          <ActivityIndicator color={COLORS.ink} />
          <Text align="center">Getting the camera ready…</Text>
        </View>
      </Screen>
    );
  }

  if (gate === 'primer') {
    return (
      <Screen
        title="Before you scan"
        subtitle="Scanning uses your camera and your phone's compass."
        footer={
          <>
            <Button
              label="Allow camera and compass"
              icon="camera-outline"
              accessibilityHint="Asks your permission for the camera and the compass, then starts the scan."
              onPress={() => void allowAndStart()}
            />
            {photoAlternative(false)}
          </>
        }
      >
        <Text>1. Stand in the middle of the room.</Text>
        <Text>2. Hold your phone upright, like you are taking a photo.</Text>
        <Text>3. Turn slowly in a full circle. The phone takes the photos for you. You feel a small tap each time.</Text>
        <Text tone="muted">
          The compass tells us which way each photo faces. Your phone asks for location access to use it. We never store
          or share your location.
        </Text>
        <Text tone="muted">Prefer not to scan? You can pick 3 photos of the room instead.</Text>
      </Screen>
    );
  }

  if (gate === 'camera-denied') {
    const settings = cameraPermission !== null && !cameraPermission.canAskAgain;
    return (
      <Screen
        title="The camera is off for this app"
        subtitle="Scanning needs the camera, but you don't have to scan."
        footer={
          <>
            {photoAlternative(true)}
            <Button
              label={settings ? 'Open Settings to turn on the camera' : 'Allow the camera'}
              icon={settings ? 'settings-outline' : 'camera-outline'}
              variant="secondary"
              accessibilityHint={settings ? 'Opens the Settings app. Turn on Camera, then come back.' : 'Asks your permission for the camera.'}
              onPress={() => void askCameraAgain()}
            />
          </>
        }
      >
        <Text>
          {settings
            ? 'The camera was turned off for this app. To scan, open Settings, turn on Camera, then come back here.'
            : 'The camera was not allowed. To scan, allow the camera when your phone asks.'}
        </Text>
        <Text>You can also pick 3 photos of the room from your library. You get the same kind of quote.</Text>
      </Screen>
    );
  }

  if (gate === 'compass') {
    const locationOff = locationPermission?.status === 'denied';
    return (
      <Screen
        title="The compass is not working"
        subtitle="Without it we can't tell which way each photo faces."
        footer={
          <>
            {photoAlternative(true)}
            {locationOff && locationPermission && !locationPermission.canAskAgain ? (
              <Button
                label="Open Settings to turn on location"
                icon="settings-outline"
                variant="secondary"
                accessibilityHint="Opens the Settings app. Turn on Location, then come back."
                onPress={() => void Linking.openSettings().catch(() => undefined)}
              />
            ) : null}
            <Button
              label="Try the compass again"
              icon="refresh-outline"
              variant="secondary"
              onPress={() => void retryCompass()}
            />
          </>
        }
      >
        <Text>
          {locationOff
            ? 'Location access is off for this app, and the phone needs it to read the compass. We only use it for direction and never store where you are.'
            : 'The compass did not answer. This can happen near metal, like a fridge or a radiator. Move a step away and try again, or wave the phone in a figure 8 to reset the compass.'}
        </Text>
        <Text>You can also pick 3 photos of the room from your library instead. You get the same kind of quote.</Text>
      </Screen>
    );
  }

  return (
    <View style={styles.camera} accessibilityLabel="Room scan">
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        animateShutter={false}
        onCameraReady={() => setCameraReady(true)}
        onMountError={() => setSend({ kind: 'error', message: 'The camera could not start. You can try again or use photos instead.', next: 'none' })}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={styles.overlayScroll}
        contentInsetAdjustmentBehavior="never"
      >
        <ScanOverlay
          state={capture}
          onFinish={finishSweep}
          onUsePhotos={() => void usePhotos()}
          style={styles.overlay}
        />
      </ScrollView>
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
  onName,
  photoAlternative,
}: {
  readonly send: Exclude<SendState, { kind: 'idle' }>;
  readonly onRetry: () => void;
  readonly onRetryNow: () => void;
  readonly onScanAgain: () => void;
  readonly onName: () => void;
  readonly photoAlternative: ReactNode;
}) {
  if (send.kind === 'picking' || send.kind === 'preparing' || send.kind === 'sending') {
    const words =
      send.kind === 'picking'
        ? 'Opening your photos…'
        : send.kind === 'preparing'
          ? 'Getting your photos ready…'
          : `Sending ${send.count} ${send.count === 1 ? 'photo' : 'photos'}. On slow Wi-Fi this can take up to a minute.`;
    return (
      <Screen>
        <View accessible accessibilityRole="progressbar" accessibilityLabel={words} accessibilityState={{ busy: true }} style={styles.center}>
          <ActivityIndicator color={COLORS.ink} size="large" />
          <Text align="center">{words}</Text>
        </View>
      </Screen>
    );
  }

  if (send.kind === 'queued') {
    return (
      <Screen title="Waiting for a connection" subtitle="Your photos are safe on this phone for now.">
        <Notice tone="info">{send.message}</Notice>
        <Text tone="muted">Keep the app open. We move on by ourselves as soon as it sends.</Text>
        <Button label="Try sending now" variant="secondary" onPress={onRetryNow} />
      </Screen>
    );
  }

  return (
    <Screen title="Something went wrong">
      <Notice tone="error">{send.message}</Notice>
      {send.next === 'name' ? <Button label="Go back and name the room" onPress={onName} /> : null}
      {send.next === 'resend' ? (
        <Button label="Try again" accessibilityHint="Sends the same photos again." onPress={onRetry} />
      ) : null}
      <Button label="Scan the room again" variant="secondary" onPress={onScanAgain} />
      {photoAlternative}
    </Screen>
  );
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  overlayScroll: {
    flexGrow: 1,
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
});
