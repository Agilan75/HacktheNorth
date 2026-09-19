import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';

import { getApi } from '@/lib/api';
import { uploadBearings } from '@/lib/capture';
import { getSweepQueue } from '@/lib/queue';
import {
  ROOM_LABEL_MAX,
  SESSION_PROBLEM_TEXT,
  TERM_OPTIONS,
  buildCreateRequest,
  sessionStore,
  useSession,
} from '@/lib/session';
import type { SessionFrame, TermMonths } from '@/lib/session';
import { Button, Card, ChoiceGroup, Heading, Notice, Screen, SPACE, Text, TextField } from '@/ui';

/**
 * New sweep — PRD §11 `/new`. Unit M5.
 *
 * Room name, term (4/8/12 months) and an optional submission id, then two
 * equal ways in: scan with the camera, or upload three photos. The upload path
 * is a first-class choice shown with equal weight to the scan, not an error
 * fallback (PRD §11 inclusivity, decision M5-3). The upload path sends the
 * sweep from here and goes straight to /analyzing; the scan path hands over to
 * /sweep (M6), which captures and sends.
 */

/** Photos the upload path asks for (PRD §11: 3 photos at 0/120/240). */
const UPLOAD_PHOTO_COUNT = 3;
/** Long edge after downscale, matching the prototype's encoder. */
const MAX_EDGE = 768;
const JPEG_QUALITY = 0.7;

const TERM_CHOICES = TERM_OPTIONS.map((t) => ({
  value: t,
  label: `${t} months`,
  accessibilityLabel: `${t} months`,
}));

const sweepQueue = getSweepQueue((req) => getApi().createSweep(req));

type UploadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'picking' }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'queued'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

/** Downscales one picked photo and returns it as a JPEG frame (also converts HEIC). */
async function toFrame(asset: ImagePicker.ImagePickerAsset, bearingDeg: number): Promise<SessionFrame> {
  const landscape = asset.width >= asset.height;
  const longEdge = Math.max(asset.width, asset.height);
  const resize =
    longEdge > MAX_EDGE ? [{ resize: landscape ? { width: MAX_EDGE } : { height: MAX_EDGE } }] : [];
  const out = await manipulateAsync(asset.uri, resize, {
    base64: true,
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  if (!out.base64) throw new Error('no image data');
  return { bearingDeg, capturedAt: new Date().toISOString(), imageBase64: out.base64, uri: out.uri };
}

export default function NewSweepScreen() {
  const router = useRouter();
  const roomLabel = useSession((s) => s.roomLabel);
  const termMonths = useSession((s) => s.termMonths);
  const submissionId = useSession((s) => s.submissionId);

  const [submissionText, setSubmissionText] = useState(submissionId ?? '');
  const [labelError, setLabelError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState>({ kind: 'idle' });
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const busy = upload.kind === 'picking' || upload.kind === 'preparing' || upload.kind === 'sending';

  /** Checks the room name; announces the problem if there is one. */
  function checkLabel(): boolean {
    const label = roomLabel.trim();
    const problem =
      label.length === 0
        ? SESSION_PROBLEM_TEXT['room-label-missing']
        : label.length > ROOM_LABEL_MAX
          ? SESSION_PROBLEM_TEXT['room-label-too-long']
          : null;
    setLabelError(problem);
    if (problem) AccessibilityInfo.announceForAccessibility(`Problem: ${problem}`);
    return problem === null;
  }

  function commitSubmission(): void {
    sessionStore.attachSubmission(submissionText);
  }

  function startScan(): void {
    commitSubmission();
    if (!checkLabel()) return;
    sessionStore.clearFrames();
    sessionStore.setSweepId(null);
    router.push('/sweep');
  }

  async function startUpload(): Promise<void> {
    commitSubmission();
    if (!checkLabel() || busy) return;

    setUpload({ kind: 'picking' });
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
        setUpload({ kind: 'error', message: 'Your photo library could not be opened. Please try again.' });
      }
      return;
    }
    if (!alive.current) return;
    if (picked.canceled || picked.assets.length === 0) {
      setUpload({ kind: 'idle' });
      return;
    }

    const assets = picked.assets.slice(0, UPLOAD_PHOTO_COUNT);
    setUpload({ kind: 'preparing' });
    let frames: SessionFrame[];
    try {
      const bearings = uploadBearings(assets.length);
      frames = await Promise.all(assets.map((a, i) => toFrame(a, bearings[i] ?? 0)));
    } catch {
      if (alive.current) {
        setUpload({
          kind: 'error',
          message: 'One of those photos could not be read. Please pick different photos.',
        });
      }
      return;
    }
    if (!alive.current) return;

    sessionStore.setSweepId(null);
    sessionStore.setFrames(frames, 'upload');
    const built = buildCreateRequest(sessionStore.getState());
    if (!built.ok) {
      setUpload({ kind: 'error', message: built.problems.map((p) => SESSION_PROBLEM_TEXT[p]).join(' ') });
      return;
    }

    setUpload({ kind: 'sending' });
    AccessibilityInfo.announceForAccessibility('Sending your photos.');
    const result = await sweepQueue.submit(built.request);
    if (result.status === 'sent') {
      sessionStore.setSweepId(result.sweep.id);
      if (alive.current) {
        setUpload({ kind: 'idle' });
        router.push('/analyzing');
      }
      return;
    }
    if (result.status === 'failed') {
      if (alive.current) setUpload({ kind: 'error', message: result.message });
      return;
    }
    // Queued: no connection. It sends on its own; move on once it has.
    if (alive.current) setUpload({ kind: 'queued', message: result.message });
    sweepQueue
      .waitFor(result.queueId)
      .then((sweep) => {
        sessionStore.setSweepId(sweep.id);
        if (alive.current) {
          setUpload({ kind: 'idle' });
          router.push('/analyzing');
        }
      })
      .catch(() => {
        if (alive.current) {
          setUpload({ kind: 'error', message: 'Your photos could not be sent. Please try again.' });
        }
      });
  }

  const uploadLabel =
    upload.kind === 'picking'
      ? 'Opening your photos…'
      : upload.kind === 'preparing'
        ? 'Getting photos ready…'
        : upload.kind === 'sending'
          ? 'Sending photos…'
          : 'Upload 3 photos instead';

  return (
    <Screen title="New sweep" subtitle="Tell us about the room, then choose how you want to show it to us.">
      <TextField
        label="Room name"
        help='For example "Kitchen" or "Bedroom".'
        value={roomLabel}
        onChangeText={(text) => {
          sessionStore.setRoomLabel(text);
          if (labelError) setLabelError(null);
        }}
        error={labelError}
        maxLength={ROOM_LABEL_MAX}
        autoCapitalize="sentences"
        autoCorrect={false}
        returnKeyType="done"
        editable={!busy}
      />

      <ChoiceGroup<TermMonths>
        label="How long do you want to be covered?"
        choices={TERM_CHOICES}
        value={termMonths}
        onChange={(t) => sessionStore.setTerm(t)}
        direction="row"
      />

      <TextField
        label="Submission ID (optional)"
        help="Only if an insurer or broker gave you one. Leave it empty if not."
        value={submissionText}
        onChangeText={setSubmissionText}
        onBlur={commitSubmission}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        editable={!busy}
      />

      <View style={{ gap: SPACE.sm }}>
        <Heading variant="heading">How do you want to show us the room?</Heading>
        <Text tone="muted">Both ways give you the same quote. Pick whichever is easier for you.</Text>
      </View>

      <Card>
        <Heading variant="heading">Scan with the camera</Heading>
        <Text>Stand in the middle of the room and turn slowly all the way around. The app takes the photos for you.</Text>
        <Button
          label="Scan the room with the camera"
          accessibilityHint="Opens the camera. Turn slowly in a circle until the ring is full."
          onPress={startScan}
          disabled={busy}
        />
      </Card>

      <Card>
        <Heading variant="heading">Upload photos</Heading>
        <Text>
          Pick 3 photos of the room from your library, each facing a different wall. Good if turning around or
          holding the phone up is hard.
        </Text>
        <Button
          label={uploadLabel}
          accessibilityLabel="Upload 3 photos instead"
          accessibilityHint="Opens your photo library. Pick 3 photos of the room."
          loading={busy}
          disabled={upload.kind === 'queued'}
          onPress={() => void startUpload()}
        />
      </Card>

      {upload.kind === 'queued' ? <Notice tone="info">{upload.message}</Notice> : null}
      {upload.kind === 'error' ? (
        <Notice tone="error" actionLabel="Try again" onAction={() => void startUpload()}>
          {upload.message}
        </Notice>
      ) : null}
    </Screen>
  );
}
