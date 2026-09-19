import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Verify your fix — PRD §11 `/verify-fix`.
 *
 * One new photo of the fixed hazard, re-run through the pipeline, returning the new verdict and the new price.
 *
 * Stub frozen by W0-4. Unit M8 builds the real screen on top of it and
 * replaces this body only. The accessibility label, the heading role and the
 * 44pt minimum target below are already in place so Run 3 cannot forget them
 * (PRD §11: inclusivity is a requirement, not a finish).
 */
export default function VerifyFixScreen() {
  const router = useRouter();

  return (
    <View
      style={styles.screen}
      accessible={false}
      accessibilityLabel="Verify your fix"
    >
      <Text accessibilityRole="header" style={styles.title}>
        Verify your fix
      </Text>
      <Text style={styles.body}>One new photo of the fixed hazard, re-run through the pipeline, returning the new verdict and the new price.</Text>
      <Text style={styles.note}>Not built yet — unit M8 fills this screen.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to my quote"
        accessibilityHint="Returns to the quote with the updated price."
        style={styles.action}
        onPress={() => {
          router.push('/verdict');
        }}
      >
        <Text style={styles.actionText}>Back to my quote</Text>
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
