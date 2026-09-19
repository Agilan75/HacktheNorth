import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Shared result — PRD §11 `/s/[slug]`.
 *
 * The read-only shareable result behind a slug, the same numbers the console and the API serve.
 *
 * Stub frozen by W0-4. Unit M9 builds the real screen on top of it and
 * replaces this body only. The accessibility label, the heading role and the
 * 44pt minimum target below are already in place so Run 3 cannot forget them
 * (PRD §11: inclusivity is a requirement, not a finish).
 */
export default function SharedResultScreen() {
  const params = useLocalSearchParams<{ slug: string }>();

  return (
    <View
      style={styles.screen}
      accessible={false}
      accessibilityLabel="Shared result"
    >
      <Text accessibilityRole="header" style={styles.title}>
        Shared result
      </Text>
      <Text style={styles.body}>The read-only shareable result behind a slug, the same numbers the console and the API serve.</Text>
      <Text style={styles.note} accessibilityLabel="Identifier">{String(params.slug ?? '')}</Text>
      <Text style={styles.note}>Not built yet — unit M9 fills this screen.</Text>
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
