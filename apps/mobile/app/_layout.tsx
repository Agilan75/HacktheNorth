import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { COLORS } from '@/ui';

/**
 * Six routes. `/` is the camera, opened on launch, and it is also the sweep:
 * there is no screen between the app starting and the viewfinder. `/analyzing`
 * streams each finding as it resolves, `/verdict` is the destination, and the
 * other three are reached only by a tap from there.
 *
 * The camera carries its own controls, so it takes no header. Every other
 * route keeps a visible header for its 44pt back target.
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: true,
          headerBackTitle: 'Back',
          headerTintColor: COLORS.ink,
          headerStyle: { backgroundColor: COLORS.paper },
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
