import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * A few questions — PRD §11 `/questions`.
 *
 * One plain-language question at a time, with a "Questions skipped" counter that expands to say why each one was skipped.
 *
 * Stub frozen by W0-4. Unit M7 builds the real screen on top of it and
 * replaces this body only. The accessibility label, the heading role and the
 * 44pt minimum target below are already in place so Run 3 cannot forget them
 * (PRD §11: inclusivity is a requirement, not a finish).
 */
export default function QuestionsScreen() {
  const router = useRouter();

  return (
    <View
      style={styles.screen}
      accessible={false}
      accessibilityLabel="A few questions"
    >
      <Text accessibilityRole="header" style={styles.title}>
        A few questions
      </Text>
      <Text style={styles.body}>One plain-language question at a time, with a "Questions skipped" counter that expands to say why each one was skipped.</Text>
      <Text style={styles.note}>Not built yet — unit M7 fills this screen.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="See my quote"
        accessibilityHint="Shows the verdict and the estimate."
        style={styles.action}
        onPress={() => {
          router.push('/verdict');
        }}
      >
        <Text style={styles.actionText}>See my quote</Text>
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
