import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Scanning the room — PRD §11 `/sweep`.
 *
 * Camera with a coverage overlay: coverage percent, a turn hint, auto-capture every 1.2 seconds once the heading advances 10 degrees, a cap of 15 frames, a haptic per capture, and Finish once coverage passes 75 percent.
 *
 * Stub frozen by W0-4. Unit M6 builds the real screen on top of it and
 * replaces this body only. The accessibility label, the heading role and the
 * 44pt minimum target below are already in place so Run 3 cannot forget them
 * (PRD §11: inclusivity is a requirement, not a finish).
 */
export default function SweepScreen() {
  const router = useRouter();

  return (
    <View
      style={styles.screen}
      accessible={false}
      accessibilityLabel="Scanning the room"
    >
      <Text accessibilityRole="header" style={styles.title}>
        Scanning the room
      </Text>
      <Text style={styles.body}>Camera with a coverage overlay: coverage percent, a turn hint, auto-capture every 1.2 seconds once the heading advances 10 degrees, a cap of 15 frames, a haptic per capture, and Finish once coverage passes 75 percent.</Text>
      <Text style={styles.note}>Not built yet — unit M6 fills this screen. Anyone who cannot sweep can upload three photos instead.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Finish scanning"
        accessibilityHint="Ends the scan and analyses the frames."
        style={styles.action}
        onPress={() => {
          router.push('/analyzing');
        }}
      >
        <Text style={styles.actionText}>Finish scanning</Text>
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
