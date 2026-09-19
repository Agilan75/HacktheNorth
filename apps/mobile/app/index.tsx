import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Your rooms — PRD §11 `/`.
 *
 * Rooms you have scanned, with a skeleton card while each one loads.
 *
 * Stub frozen by W0-4. Unit M5 builds the real screen on top of it and
 * replaces this body only. The accessibility label, the heading role and the
 * 44pt minimum target below are already in place so Run 3 cannot forget them
 * (PRD §11: inclusivity is a requirement, not a finish).
 */
export default function RoomsScreen() {
  const router = useRouter();

  return (
    <View
      style={styles.screen}
      accessible={false}
      accessibilityLabel="Your rooms"
    >
      <Text accessibilityRole="header" style={styles.title}>
        Your rooms
      </Text>
      <Text style={styles.body}>Rooms you have scanned, with a skeleton card while each one loads.</Text>
      <Text style={styles.note}>Not built yet — unit M5 fills this screen.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New sweep"
        accessibilityHint="Starts a new room scan."
        style={styles.action}
        onPress={() => {
          router.push('/new');
        }}
      >
        <Text style={styles.actionText}>New sweep</Text>
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
