import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Your quote — PRD §11 `/verdict`.
 *
 * The verdict in words as well as colour, the estimate with its breakdown, the deciding rule, the fix, and the next-step sheet.
 *
 * Stub frozen by W0-4. Unit M8 builds the real screen on top of it and
 * replaces this body only. The accessibility label, the heading role and the
 * 44pt minimum target below are already in place so Run 3 cannot forget them
 * (PRD §11: inclusivity is a requirement, not a finish).
 */
export default function VerdictScreen() {
  const router = useRouter();

  return (
    <View
      style={styles.screen}
      accessible={false}
      accessibilityLabel="Your quote"
    >
      <Text accessibilityRole="header" style={styles.title}>
        Your quote
      </Text>
      <Text style={styles.body}>The verdict in words as well as colour, the estimate with its breakdown, the deciding rule, the fix, and the next-step sheet.</Text>
      <Text style={styles.note}>Not built yet — unit M8 fills this screen.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Verify my fix"
        accessibilityHint="Takes a new photo of the hazard you fixed and re-prices the quote."
        style={styles.action}
        onPress={() => {
          router.push('/verify-fix');
        }}
      >
        <Text style={styles.actionText}>Verify my fix</Text>
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
