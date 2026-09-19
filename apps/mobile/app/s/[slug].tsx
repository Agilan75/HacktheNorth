import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Share, View } from 'react-native';
import * as Linking from 'expo-linking';
import type { ShareDto } from '@retrofit/contracts';

import { describeApiError, getApi, isApiError } from '@/lib/api';
import { COLORS, Button, Card, Heading, Notice, SPACE, Screen, SkeletonCard, Text, VerdictPill } from '@/ui';

/**
 * Shared result — PRD §11 `/s/[slug]` (unit M9).
 *
 * The read-only result behind a share slug (GET /s/:slug): the verdict in
 * words and a glyph, the price, the plain explanation, the deciding rule with
 * its quote, and the smallest change that would reach FIT. Every number is the
 * API's; this screen formats, it never computes.
 */

type Verdict = ShareDto['verdict'];

/** Tenant-facing words; commercial results keep the kit's underwriting labels. */
const TENANT_VERDICT_WORDS: Readonly<Record<Verdict, string>> = {
  FIT: 'We can quote this',
  REFER: 'An underwriter needs a quick look',
  DOES_NOT_FIT: 'We cannot quote this yet',
};

function money(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

function dateWords(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string; readonly retryable: boolean }
  | { readonly status: 'ready'; readonly share: ShareDto };

function errorFor(error: unknown): { message: string; retryable: boolean } {
  if (isApiError(error) && error.kind === 'http') {
    if (error.status === 404) return { message: 'We could not find this shared result. The link may be wrong or out of date.', retryable: false };
    if (error.status === 409) return { message: 'This result is not ready yet. Please try again in a minute.', retryable: true };
  }
  return { message: describeApiError(error), retryable: true };
}

export default function SharedResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? '';
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (slug.trim().length === 0) {
      setLoad({ status: 'error', message: 'This link is missing the part that says which result to show.', retryable: false });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    getApi()
      .getShare(slug, { signal: controller.signal })
      .then((share) => setLoad({ status: 'ready', share }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', ...errorFor(error) });
      });
    return () => controller.abort();
  }, [slug, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (load.status === 'loading') {
    return (
      <Screen>
        <SkeletonCard accessibilityLabel="Loading the shared result" lines={2} />
        <SkeletonCard accessibilityLabel="Loading the shared result" lines={3} />
      </Screen>
    );
  }
  if (load.status === 'error') {
    return (
      <Screen>
        <Notice tone="error" {...(load.retryable ? { actionLabel: 'Try again', onAction: retry } : {})}>
          {load.message}
        </Notice>
        <Button label="Get your own quote" variant="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  return <SharedResult share={load.share} />;
}

/* -------------------------------------------------------------------------- */

function SharedResult({ share }: { readonly share: ShareDto }) {
  const router = useRouter();
  const [shareError, setShareError] = useState<string | null>(null);
  const tenant = share.lineOfBusiness === 'tenant';
  const verdictText = tenant ? TENANT_VERDICT_WORDS[share.verdict] : undefined;
  const price = share.price;
  const monthly = money(price.predictedMonthlyPremium);
  const yearly = money(price.predictedPremium);
  const when = dateWords(share.createdAt);
  const flip = share.flip.flip;

  const priceLine = tenant && monthly
    ? `About ${monthly} a month${price.termMonths ? ` for ${price.termMonths} months` : ''}.`
    : yearly
      ? `About ${yearly} a year.`
      : null;

  const onShare = useCallback(async () => {
    setShareError(null);
    const url = Linking.createURL(`/s/${encodeURIComponent(share.slug)}`);
    const words = verdictText ?? share.verdict;
    try {
      await Share.share({ message: `My Retrofit result: ${words}.${priceLine ? ` ${priceLine}` : ''} ${url}`, url });
    } catch {
      setShareError('Sharing did not open. Please try again.');
    }
  }, [share.slug, share.verdict, verdictText, priceLine]);

  return (
    <Screen
      footer={
        <>
          <Button
            label="Share this result"
            accessibilityHint="Opens the share sheet with a link to this result."
            onPress={() => {
              void onShare();
            }}
          />
          <Button label="Get your own quote" variant="secondary" onPress={() => router.push('/new')} />
        </>
      }
    >
      <View style={{ gap: SPACE.sm }}>
        <Heading>{tenant ? 'Tenant insurance result' : 'Property insurance result'}</Heading>
        {when ? (
          <Text variant="small" tone="muted">
            {`Checked on ${when}. This is a read-only copy.`}
          </Text>
        ) : null}
      </View>

      {shareError ? <Notice tone="error">{shareError}</Notice> : null}

      <Card>
        <VerdictPill verdict={share.verdict} {...(verdictText ? { text: verdictText } : {})} size="large" />
        {priceLine ? (
          <Text variant="heading" weight="semibold">
            {priceLine}
          </Text>
        ) : (
          <Text tone="muted">No price yet: some details were missing.</Text>
        )}
        {price.estimate ? (
          <Text variant="small" tone="muted">
            This price is an estimate.
          </Text>
        ) : null}
        <Text variant="small" tone="muted">
          {`Match with the insurer's guidelines: ${Math.round(share.appetiteScore)} out of 100.`}
        </Text>
      </Card>

      {share.explanation ? (
        <Card>
          <Heading variant="heading">Why</Heading>
          <Text>{share.explanation}</Text>
        </Card>
      ) : null}

      {share.decidingRule ? (
        <Card>
          <Heading variant="heading">The rule that decided it</Heading>
          <View
            accessible
            accessibilityLabel={`${share.decidingRule.citation.doc}, ${share.decidingRule.citation.section}: ${share.decidingRule.citation.quote}`}
            style={{ gap: SPACE.xs, borderLeftWidth: 3, borderLeftColor: COLORS.muted, paddingLeft: SPACE.md }}
          >
            <Text variant="small" tone="muted">
              {`${share.decidingRule.citation.doc}, ${share.decidingRule.citation.section}`}
            </Text>
            <Text>{`“${share.decidingRule.citation.quote}”`}</Text>
          </View>
        </Card>
      ) : null}

      {flip && flip.moves.length > 0 ? (
        <Card tone="accent">
          <Heading variant="heading">{flip.moves.length === 1 ? 'The one change that would help' : 'The changes that would help'}</Heading>
          {flip.moves.map((m) => (
            <View key={m.componentKey} accessible accessibilityLabel={m.fixHint ? `${m.label}. ${m.fixHint}` : m.label} style={{ gap: SPACE.xs }}>
              <Text weight="semibold">{`• ${m.label}`}</Text>
              {m.fixHint ? <Text variant="small">{m.fixHint}</Text> : null}
            </View>
          ))}
          <Text>Then the result becomes</Text>
          <VerdictPill
            verdict={flip.verdictAfter}
            {...(tenant ? { text: TENANT_VERDICT_WORDS[flip.verdictAfter] } : {})}
          />
          {money(flip.premiumAfter) ? <Text>{`Price: about ${money(flip.premiumAfter)} a year.`}</Text> : null}
        </Card>
      ) : null}
    </Screen>
  );
}
