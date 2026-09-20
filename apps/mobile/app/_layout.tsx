import { useEffect } from 'react';
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
 * Six routes. `/` is the camera, opened on launch, and it is also the sweep:
 * there is no screen between the app starting and the viewfinder. `/analyzing`
 * streams each finding as it resolves, `/verdict` is the destination, and the
 * other three are reached only by a tap from there.
 *
 * The camera carries its own controls, so it takes no header. Every other
 * route keeps a visible header for its 44pt back target.
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
          <Button label="Start a new scan" variant="secondary" onPress={() => router.replace('/')} />
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

  if (!loaded && error === null) return null;

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
        <Stack.Screen name="analyzing" options={{ title: 'Reading the room', headerBackVisible: false }} />
        <Stack.Screen name="verdict" options={{ title: 'Quote', headerBackVisible: false }} />
        <Stack.Screen name="verify-fix" options={{ title: 'Recheck' }} />
        <Stack.Screen name="hazard/[id]" options={{ title: 'Finding' }} />
        <Stack.Screen name="s/[slug]" options={{ title: 'Result' }} />
      </Stack>
    </>
  );
}
