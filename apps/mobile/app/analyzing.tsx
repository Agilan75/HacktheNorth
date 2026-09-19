import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Working it out — PRD §11 `/analyzing`.
 *
 * Staged loaders driven by the real sweep stage value from the API, never by a timer.
 *
 * Stub frozen by W0-4. Unit M6 builds the real screen on top of it and
 * replaces this body only. The accessibility label, the heading role and the
 * 44pt minimum target below are already in place so Run 3 cannot forget them
 * (PRD §11: inclusivity is a requirement, not a finish).
 */
export default function AnalyzingScreen() {
  const router = useRouter();

  return (
    <View
      style={styles.screen}
      accessible={false}
      accessibilityLabel="Working it out"
    >
      <Text accessibilityRole="header" style={styles.title}>
        Working it out
      </Text>
      <Text style={styles.body}>Staged loaders driven by the real sweep stage value from the API, never by a timer.</Text>
      <Text style={styles.note}>Not built yet — unit M6 fills this screen.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="See what we found"
        accessibilityHint="Shows the items detected in the room."
        style={styles.action}
        onPress={() => {
          router.push('/confirm');
        }}
      >
        <Text style={styles.actionText}>See what we found</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    backgroundColor: '#FAF8F2',
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 28,
    lineHeight: 32,
    color: '#1F1E1B',
  },
  body: {
    fontSize: 17,
    lineHeight: 24,
    color: '#5E6357',
  },
  note: {
    fontSize: 15,
    lineHeight: 20,
    color: '#7C8073',
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E4002B',
    backgroundColor: '#E4002B',
  },
  actionText: {
    fontSize: 17,
    lineHeight: 24,
    color: '#FAF8F2',
    textAlign: 'center',
  },
});
