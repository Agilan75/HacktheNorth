import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { COLORS, FONT_FAMILIES } from '@retrofit/design';

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
          headerStyle: { backgroundColor: COLORS.paper },
          headerTitleStyle: { fontFamily: FONT_FAMILIES.display },
          contentStyle: { backgroundColor: COLORS.paper },
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
