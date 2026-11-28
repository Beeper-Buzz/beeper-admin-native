import { visitorName } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { withKeys } from '@/components/keys';
import { Badge, Button, EmptyState, Screen } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { clockTime, duration, shortUrl, timeAgo } from '@/components/time';
import { useCan } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';
import { cartLabel, deviceLabel } from './rows';
import { useMessageVisitor } from './use-visitors';

/** One storefront session: who and where from, the page timeline (newest first) and its cart. */
export function SessionDetail({ id, now = new Date() }: { id: string; now?: Date }) {
  const trpc = useTRPC();
  const can = useCan();
  const { colors } = useTheme();
  const session = useQuery(trpc.visitors.get.queryOptions({ id }));
  const s = session.data;
  const cart = useQuery({
    ...trpc.carts.get.queryOptions({ number: s?.cart?.orderNumber ?? '' }),
    enabled: !!s?.cart && can('carts'),
    retry: false,
  });
  const message = useMessageVisitor();

  if (session.isPending)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: space[8] }} />
      </Screen>
    );
  if (!s)
    return (
      <Screen>
        <EmptyState title="Couldn't load this visit" body={session.error?.message ?? 'Try again.'} />
      </Screen>
    );
  const name = visitorName(s);
  const pages = newestFirst(s.pages);
  const facts = [
    deviceLabel(s.device),
    s.country,
    s.startedAt ? `Arrived ${clockTime(s.startedAt, now)}` : null,
    duration(s.startedAt, s.lastSeenAt),
    `${s.pageViews} ${s.pageViews === 1 ? 'page' : 'pages'}`,
  ].filter(Boolean);
  const source = [
    s.referrer ? `From ${shortHost(s.referrer)}` : 'Direct visit',
    s.utm ? [s.utm.source, s.utm.medium, s.utm.campaign].filter(Boolean).join(' / ') : null,
  ].filter(Boolean);

  return (
    <Screen>
      <Stack.Screen options={{ title: name }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: layout.gutter, gap: space[5] }}
      >
        <View style={{ gap: space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <Badge
              tone={s.online ? 'positive' : 'neutral'}
              label={s.online ? 'Online now' : `Seen ${timeAgo(s.lastSeenAt, now.getTime())} ago`}
            />
          </View>
          {s.contact?.email ? <Text tone="muted">{s.contact.email}</Text> : null}
          <Text size="footnote" tone="muted">
            {facts.join(' · ')}
          </Text>
          <Text size="footnote" tone="muted">
            {source.join(' · ')}
          </Text>
          {can('inbox') ? (
            <Button
              title={s.conversationId ? 'Open chat' : 'Message'}
              variant="tonal"
              loading={message.isPending}
              onPress={() =>
                s.conversationId
                  ? router.push({ pathname: '/inbox/[id]', params: { id: s.conversationId } })
                  : message.mutate({ id: s.id })
              }
            />
          ) : null}
        </View>

        {s.cart ? (
          <View style={{ gap: space[2] }}>
            <Label accessibilityRole="header">Cart</Label>
            {withKeys(cart.data?.items ?? [], (x) => x.name).map(({ key, item }) => (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                {item.imageUrl ? (
                  <Image
                    source={{ uri: item.imageUrl }}
                    style={[styles.thumb, { backgroundColor: colors.surface }]}
                  />
                ) : (
                  <View style={[styles.thumb, { backgroundColor: colors.surfaceSunk }]} />
                )}
                <Text style={{ flex: 1 }} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text font="mono" tone="muted">
                  ×{item.quantity}
                </Text>
              </View>
            ))}
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open order ${s.cart.orderNumber}, ${cartLabel(s.cart)}`}
              onPress={() =>
                router.push({ pathname: '/orders/[id]', params: { id: s.cart?.orderNumber ?? '' } })
              }
            >
              <Text font="mono" tone="accent">
                {s.cart.orderNumber} · {cartLabel(s.cart)} ›
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ gap: space[2] }}>
          <Label accessibilityRole="header">Pages</Label>
          {pages.length ? (
            withKeys(pages, (x) => `${x.url}@${x.at}`).map(({ key, item: p }) => (
              <View
                key={key}
                accessible
                accessibilityLabel={`${p.title ?? shortUrl(p.url)}, ${clockTime(p.at, now)}`}
                style={[
                  styles.page,
                  { borderLeftColor: p === pages[0] && s.online ? colors.positive : colors.line },
                ]}
              >
                <Text numberOfLines={1}>{p.title ?? shortUrl(p.url)}</Text>
                <Text size="caption" tone="muted" font="mono" numberOfLines={1}>
                  {[clockTime(p.at, now), shortUrl(p.url)].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))
          ) : (
            <Text tone="muted">No pages recorded.</Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * Page views newest first. The spec says the store sends them that way, but adapters differ (the
 * 4.2 demo appends), so they are sorted by time; ones without a time keep their place at the end.
 */
export function newestFirst<T extends { at: string | null }>(pages: readonly T[]): T[] {
  const time = (p: T) => (p.at ? Date.parse(p.at) : Number.NaN);
  const timed = pages.filter((p) => Number.isFinite(time(p)));
  const untimed = pages.filter((p) => !Number.isFinite(time(p)));
  return [...timed.sort((a, b) => time(b) - time(a)), ...untimed];
}

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  thumb: { width: 40, height: 40, borderRadius: radius.badge },
  page: { borderLeftWidth: 3, paddingLeft: space[3], paddingVertical: space[1], gap: 2 },
});
