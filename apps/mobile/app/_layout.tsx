import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { COLORS, FONT_FAMILIES } from '@retrofit/design';

import { Button, Notice, Screen, Text } from '@/ui';

/**
 * Seven routes. `/` is home: it names the room, picks the term, and lists the
 * rooms this launch has sent. `/scan` is the camera and it is also the sweep.
 * `/analyzing` streams each finding as it resolves, `/verdict` is the
 * destination, and the other three are reached only by a tap from there.
 *
 * `/` and `/scan` take no header: home draws its own name, and the camera
 * carries its own controls. Every other route keeps a visible header for its
 * 44pt back target.
 *
 * `anchor` puts home under a cold deep link, so a link straight to a quote can
 * still go back somewhere. Every "start over" edge uses `dismissTo`, never
 * `replace`: with home permanently underneath, replacing the top frame with `/`
 * would leave two home screens stacked on each other.
 *
 * The three type faces are registered here and nowhere else. One name per face:
 * a phone cannot synthesise a weight for a custom font, so Inter Regular and
 * Inter SemiBold are separate families as far as the platform is concerned.
 * The splash screen is held until they are in, so no screen ever paints in a
 * fallback serif and then reflows.
 */

// Rejecting here only means the splash was already gone; it is never fatal.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Home sits under every deep link. Without it, opening `retrofit://verdict` or
 * a shared `retrofit://s/<slug>` cold gives a one-frame stack with nothing to
 * go back to.
 */
export const unstable_settings = { anchor: 'index' };

/**
 * Anything that throws while a screen renders lands here. expo-router picks
 * this up by name, and without it a render error leaves the window painted in
 * nothing at all — the black screen, with no way back and nothing to read.
 *
 * The message is kept on screen rather than swallowed: it is the only place
 * the reason for a blank screen is ever visible on a device.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <Screen
      title="That screen stopped"
      footer={
        <>
          <Button label="Try again" onPress={() => void retry()} />
          {/* Home, not the camera: after a render crash the last thing to reopen is an AR session. */}
          <Button label="Start over" variant="secondary" onPress={() => router.dismissTo('/')} />
        </>
      }
    >
      <Notice tone="error">The screen could not be drawn. Your scan is safe.</Notice>
      <Text variant="small" tone="muted">
        {error.message}
      </Text>
    </Screen>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    [FONT_FAMILIES.display]: Fraunces_600SemiBold,
    [FONT_FAMILIES.body]: Inter_400Regular,
    [FONT_FAMILIES.bodyStrong]: Inter_600SemiBold,
  });

  useEffect(() => {
    // A font that fails to load is not a reason to hold the app behind a splash
    // screen for ever: the platform falls back, and the app still works.
    if (loaded || error !== null) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded, error]);

  // Never nothing: a root that renders nothing is a blank window with no way
  // back and no error to read. Paper, until the faces are in.
  if (!loaded && error === null) return <View style={{ flex: 1, backgroundColor: COLORS.bone }} />;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: true,
          headerBackTitle: 'Back',
          headerTintColor: COLORS.ink,
          headerStyle: { backgroundColor: COLORS.bone },
          headerTitleStyle: { fontFamily: FONT_FAMILIES.display },
          contentStyle: { backgroundColor: COLORS.bone },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="scan" options={{ headerShown: false }} />
        {/*
          Both of these hid their back button when the camera was the root and
          there was nothing behind them worth returning to. Home is behind them
          now, so the native back target is a free, correctly sized way out of
          a long poll or a quote that never priced. Leaving `/analyzing` early
          is safe: its poll aborts on unmount and its resolve is guarded.
        */}
        <Stack.Screen name="analyzing" options={{ title: 'Reading the room' }} />
        <Stack.Screen name="verdict" options={{ title: 'Quote' }} />
        <Stack.Screen name="verify-fix" options={{ title: 'Recheck' }} />
        <Stack.Screen name="hazard/[id]" options={{ title: 'Finding' }} />
        <Stack.Screen name="s/[slug]" options={{ title: 'Result' }} />
      </Stack>
    </>
  );
}
