# Retrofit — the phone app

A camera that produces a price. Launch opens the viewfinder, you turn once, and
Finish is the only tap between there and a tenant quote. Nothing is asked that
the camera can answer, and nobody is asked what their belongings are worth.

Expo SDK 57, Expo Router, React Native 0.86, New Architecture.

---

## Two ways to run it

| Path | Camera | Pose | Coverage wash | Needs |
| --- | --- | --- | --- | --- |
| **Expo Go** | `expo-camera` | `expo-sensors` DeviceMotion + compass | A band at a fixed radius | Nothing but the Expo Go app |
| **Development build** | ViroReact AR session | The AR camera transform | Painted on the detected wall planes | A native build, below |

The Expo Go path is the primary one and always works. The app picks the AR path
only when the native module is present **and** the AR session is producing
camera transforms; if either is untrue it uses the sensors, within a second, on
its own. A failed Viro build cannot stop the app from running.

---

## Before anything

```bash
npm install                       # once, from the repo root
```

Point the app at an API. Either the deployed one or a tunnel to a local server:

```bash
# from the repo root
export EXPO_PUBLIC_API_URL=https://api-production-e7f5.up.railway.app
# or, for a local API:
npm run dev:api
npx cloudflared tunnel --url http://localhost:3000   # use the https URL it prints
```

`EXPO_PUBLIC_*` is inlined at bundle time, so set it before starting Metro.

---

## Expo Go

```bash
npm run dev:mobile           # or: npx expo start --clear
```

Scan the QR code with Expo Go. On a physical Android device over USB:

```bash
adb devices                  # the device must say `device`, not `unauthorized`
npx expo start --tunnel      # or --lan on the same Wi-Fi
```

The camera and the compass are device-only. An emulator will render every
screen and the photo-upload path, but it cannot sweep.

---

## Development build (the AR path)

### Windows / Android

Needs the Android SDK, a JDK that the Android Gradle Plugin accepts (17 or 21;
Android Studio's bundled JBR may be newer than AGP supports), and a device with
ARCore.

```bash
cd apps/mobile
npx expo prebuild --platform android     # generates android/, applies the config plugins
npx expo run:android                     # builds and installs on the connected device
```

`prebuild` is what applies `@reactvision/react-viro`'s config plugin. The
generated `android/` directory is disposable: delete it and run `prebuild`
again after changing anything in `app.json`.

### macOS / iOS

```bash
cd apps/mobile
npx expo prebuild --platform ios
npx expo run:ios --device                # ARKit needs a real device
```

### EAS Build, either platform

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android --profile development
eas build --platform ios --profile development
```

Install the resulting build, then `npx expo start --dev-client`.

---

## Checks

```bash
npm run typecheck -w @retrofit/mobile
npx vitest run --project mobile          # from the repo root
cd apps/mobile && npx expo-doctor
```

Only the pure logic under `src/` runs in node: the capture state machine, the
heading maths, the pose projection, the offline queue, the session and the
photo helpers. Screens are checked by `tsc` and on a device.

---

## What lives where

```
app/                     six routes, nothing more
  index.tsx              the viewfinder, and the sweep
  analyzing.tsx          findings stream in as they resolve
  verdict.tsx            price, findings, fix, inline edits, one optional question
  hazard/[id].tsx        one finding, its photo, what fixing it does
  verify-fix.tsx         one photo of a fix, before and after
  s/[slug].tsx           the shareable result, and the only attribution
src/ar/
  pose.ts                the pose interface, the projection, the coverage geometry
  pose.gyro.ts           DeviceMotion + compass, complementary filter (Expo Go)
  pose.viro.ts           the AR camera transform and the wall planes (dev build)
  ViroSession.tsx        the AR session host, every Viro touch guarded
  ArOverlay.tsx          composes the four overlays over the camera
  overlay/               CoverageWash, HazardPin, ValueTag, Hud
src/lib/                 api, capture, heading, livePrice, photos, queue, session
src/ui/                  the kit: Button, Card, Text, Screen, VerdictPill
```

Every number on screen comes from the API. The app formats and compares; it
never computes a price, a score or a verdict.
