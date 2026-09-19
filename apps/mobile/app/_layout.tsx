import { Pressable } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Icon, MIN_TOUCH_TARGET } from '@/ui';

/**
 * The Expo Router stack for the tenant quote flow (PRD §11), plus one added
 * route: `about` (product story, reachable only from a header button on
 * `index`). Every PRD §11 route keeps its original name, title and params
 * contract — nothing here changes what an existing route means.
 *
 * Accessibility is a requirement, not a finish (PRD §11): titles are plain
 * language, the header is left visible so the back affordance keeps its 44pt
 * target, and `headerBackTitle` stays short enough not to truncate at the
 * largest dynamic type size.
 */

/** The rooms list's only header addition: a 44pt info button that opens `/about`. */
function AboutButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="About Retrofit"
      accessibilityHint="Shows what Retrofit is and how it works."
      onPress={() => router.push('/about')}
      hitSlop={8}
      style={{ minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="information-circle-outline" size={24} color="#1F1E1B" accessible={false} />
    </Pressable>
  );
}

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
        <Stack.Screen name="index" options={{ title: 'Your rooms', headerRight: () => <AboutButton /> }} />
        <Stack.Screen name="new" options={{ title: 'New sweep' }} />
        <Stack.Screen name="sweep" options={{ title: 'Scanning the room' }} />
        <Stack.Screen name="analyzing" options={{ title: 'Working it out' }} />
        <Stack.Screen name="confirm" options={{ title: 'Check what we found' }} />
        <Stack.Screen name="questions" options={{ title: 'A few questions' }} />
        <Stack.Screen name="verdict" options={{ title: 'Your quote' }} />
        <Stack.Screen name="verify-fix" options={{ title: 'Verify your fix' }} />
        <Stack.Screen name="hazard/[id]" options={{ title: 'What we found' }} />
        <Stack.Screen name="s/[slug]" options={{ title: 'Shared result' }} />
        <Stack.Screen name="about" options={{ title: 'About Retrofit' }} />
      </Stack>
    </>
  );
}
