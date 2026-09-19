import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import type { LiveEntry, LiveReport, LiveSnapshot, LiveStatus } from '@/lib/livePrice';
import { COLORS, RADIUS, SPACE, Text } from './kit';

const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

const STATUS_WORD: Readonly<Record<LiveStatus, string>> = {
  ballpark: 'typical price',
  searching: 'checking online…',
  sourced: 'price found online',
  no_source: 'typical price',
};

function title(e: LiveEntry): string {
  const brandModel = [e.item.brand, e.item.model].filter(Boolean).join(' ');
  return brandModel.length > 0 ? `${brandModel} (${e.item.name})` : e.item.name;
}

/** The chips over the camera: newest item first, with a running total. */
export function LivePriceStrip({ snap }: { readonly snap: LiveSnapshot }) {
  if (snap.entries.length === 0 && snap.identifying === 0) return null;
  const recent = [...snap.entries].reverse().slice(0, 4);
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${snap.entries.length} items priced so far, about ${usd(snap.total)} in total.`}
      style={styles.strip}
    >
      <View style={styles.row}>
        <Text variant="small" weight="semibold" tone="inverse">
          {snap.entries.length} {snap.entries.length === 1 ? 'item' : 'items'} · {usd(snap.total)}
        </Text>
        {snap.identifying > 0 || snap.searching > 0 ? <ActivityIndicator size="small" color={COLORS.paper} /> : null}
      </View>
      {recent.map((e) => (
        <View key={e.item.key} style={styles.row}>
          <Text variant="micro" tone="inverse" numberOfLines={1} style={styles.grow}>
            {title(e)}
          </Text>
          <Text variant="micro" tone="inverse" weight="semibold">
            {e.status === 'searching' ? `~${usd(e.price)}` : usd(e.price)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The one report after Finish. */
export function PriceReport({ report }: { readonly report: LiveReport }) {
  if (report.entries.length === 0) {
    return <Text tone="muted">No furniture or appliances were recognised in this scan.</Text>;
  }
  return (
    <ScrollView contentContainerStyle={{ gap: SPACE.md }}>
      <View style={styles.totalCard}>
        <Text variant="small" tone="muted">
          Estimated replacement value
        </Text>
        <Text variant="display">{usd(report.total)}</Text>
        <Text variant="small" tone="muted">
          {report.entries.length} {report.entries.length === 1 ? 'item' : 'items'} · {report.sourcedCount} priced from
          online listings, the rest at typical prices
          {report.unfinished > 0 ? ` (${report.unfinished} still being checked)` : ''}.
        </Text>
      </View>
      {report.entries.map((e) => (
        <View key={e.item.key} style={styles.line} accessible accessibilityLabel={`${title(e)}, ${usd(e.price)}, ${STATUS_WORD[e.status]}`}>
          <View style={styles.grow}>
            <Text weight="semibold">{title(e)}</Text>
            <Text variant="micro" tone="muted">
              {STATUS_WORD[e.status]}
              {e.status === 'sourced' && e.sources.length > 0
                ? ` · ${e.sources.length} ${e.sources.length === 1 ? 'listing' : 'listings'}`
                : ''}
            </Text>
          </View>
          <Text weight="semibold">{usd(e.price)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: {
    alignSelf: 'stretch',
    gap: SPACE.xs,
    padding: SPACE.md,
    borderRadius: RADIUS.card,
    backgroundColor: 'rgba(31, 30, 27, 0.72)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
  },
  grow: {
    flex: 1,
  },
  totalCard: {
    gap: SPACE.xs,
    padding: SPACE.lg,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.mutedTint,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: SPACE.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.muted,
  },
});
