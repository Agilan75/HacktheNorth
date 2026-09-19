import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * New sweep — PRD §11 `/new`.
 *
 * Name the room, choose a term of 4, 8 or 12 months, and optionally attach the sweep to an existing submission.
 *
 * Stub frozen by W0-4. Unit M5 builds the real screen on top of it and
 * replaces this body only. The accessibility label, the heading role and the
 * 44pt minimum target below are already in place so Run 3 cannot forget them
 * (PRD §11: inclusivity is a requirement, not a finish).
 */
export default function NewSweepScreen() {
  const router = useRouter();

  return (
    <View
      style={styles.screen}
      accessible={false}
      accessibilityLabel="New sweep"
    >
      <Text accessibilityRole="header" style={styles.title}>
        New sweep
      </Text>
      <Text style={styles.body}>Name the room, choose a term of 4, 8 or 12 months, and optionally attach the sweep to an existing submission.</Text>
      <Text style={styles.note}>Not built yet — unit M5 fills this screen.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start scanning"
        accessibilityHint="Opens the camera to scan the room."
        style={styles.action}
        onPress={() => {
          router.push('/sweep');
        }}
      >
        <Text style={styles.actionText}>Start scanning</Text>
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
