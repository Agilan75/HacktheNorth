import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Brand, Button, COLORS, Card, Heading, Hero, Icon, SPACE, Screen, Text } from '@/ui';
import type { IconName } from '@/ui';

/**
 * About — a new screen, not in the frozen PRD §11 route table. Reachable from
 * a header button on `/` (the rooms list) only, so it adds one route without
 * touching what any existing route means or any existing `router.push`/
 * `replace` call across the app.
 *
 * Plain-language product story. Every claim here is something the rest of the
 * app actually does — nothing is invented for this screen.
 */

interface Step {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
}

const STEPS: readonly Step[] = [
  {
    icon: 'camera-outline',
    title: 'Show us the room',
    body: 'Turn slowly with your camera, or pick three photos instead. Both give you the same kind of quote.',
  },
  {
    icon: 'search-outline',
    title: 'We look for what matters',
    body: 'The photos are checked for things that affect a renter’s policy — a heater near curtains, a missing smoke detector — the same things an inspector would look for.',
  },
  {
    icon: 'document-text-outline',
    title: 'You get a quote and the reasons why',
    body: 'A price estimate, the rule that decided it, and exactly what to fix if you want a better one — no long form.',
  },
];

function StepRow({ step, index }: { readonly step: Step; readonly index: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`Step ${index + 1}: ${step.title}. ${step.body}`}
      style={{ flexDirection: 'row', gap: SPACE.md, alignItems: 'flex-start' }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: COLORS.mutedTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={step.icon} size={20} color={COLORS.ink} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="semibold">{step.title}</Text>
        <Text tone="muted" variant="small">
          {step.body}
        </Text>
      </View>
    </View>
  );
}

export default function AboutScreen() {
  const router = useRouter();
  return (
    <Screen
      footer={<Button label="Back to your rooms" variant="secondary" onPress={() => router.back()} />}
    >
      <Hero tone="ink" accessibilityLabel="Retrofit: the camera replaces the form.">
        <Brand size={44} showWordmark={false} style={{ alignSelf: 'flex-start' }} />
        <Text variant="title" tone="inverse" weight="semibold">
          The camera replaces the form
        </Text>
        <Text tone="inverse">
          Renters usually get a quote from a form that never sees the room. Retrofit looks at the room
          itself, so the price reflects what is actually there — and you find out what to fix.
        </Text>
      </Hero>

      <View style={{ gap: SPACE.lg }}>
        <Heading variant="heading">How it works</Heading>
        {STEPS.map((step, i) => (
          <StepRow key={step.title} step={step} index={i} />
        ))}
      </View>

      <Card tone="muted">
        <View style={{ flexDirection: 'row', gap: SPACE.sm, alignItems: 'center' }}>
          <Icon name="lock-closed-outline" size={18} color={COLORS.mutedDeep} accessible={false} />
          <Heading variant="heading">Your photos</Heading>
        </View>
        <Text>
          Your photos are used only to work out your quote — checked for the things that affect a
          renter’s policy, then kept with this room so you can come back to it. Every number on your
          quote is worked out by a fixed set of rules, never guessed.
        </Text>
      </Card>

      <Card>
        <Heading variant="heading">Every verdict cites its rule</Heading>
        <Text>
          Retrofit never lets a model decide your price or your result. Code applies the insurer’s
          guidelines and the rule that decided your quote is always shown in plain language, with the
          exact line it came from.
        </Text>
      </Card>

      <Text variant="small" tone="muted" align="center">
        Built for Hack the North 2026.
      </Text>
    </Screen>
  );
}
