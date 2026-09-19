import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

/**
 * FROZEN (W0-4) — the Expo Router stack for the tenant quote flow (PRD §11).
 *
 * Every route of PRD §11 is registered here with its screen title, which is
 * also what VoiceOver announces on entry. Run 3 units M5–M9 fill the screens;
 * nobody edits this file. A new route goes through docs/contracts/requests/.
 *
 * Accessibility is a requirement, not a finish (PRD §11): titles are plain
 * language, the header is left visible so the back affordance keeps its 44pt
 * target, and `headerBackTitle` stays short enough not to truncate at the
 * largest dynamic type size.
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: true,
          headerBackTitle: 'Back',
          headerTintColor: '#1F1E1B',
          headerStyle: { backgroundColor: '#FAF8F2' },
          contentStyle: { backgroundColor: '#FAF8F2' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Your rooms' }} />
        <Stack.Screen name="new" options={{ title: 'New sweep' }} />
        <Stack.Screen name="sweep" options={{ title: 'Scanning the room' }} />
        <Stack.Screen name="analyzing" options={{ title: 'Working it out' }} />
        <Stack.Screen name="confirm" options={{ title: 'Check what we found' }} />
        <Stack.Screen name="questions" options={{ title: 'A few questions' }} />
        <Stack.Screen name="verdict" options={{ title: 'Your quote' }} />
        <Stack.Screen name="verify-fix" options={{ title: 'Verify your fix' }} />
        <Stack.Screen name="hazard/[id]" options={{ title: 'What we found' }} />
        <Stack.Screen name="s/[slug]" options={{ title: 'Shared result' }} />
      </Stack>
    </>
  );
}
