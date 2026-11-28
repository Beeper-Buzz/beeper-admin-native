import { type ConversationDetail, customerName, formatMoney } from '@instincts/spree-domain';
import { radius, space } from '@instincts/spree-ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { withKeys } from '@/components/keys';
import { Badge, Button, EmptyState, Sheet } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { clockTime, shortUrl, timeAgo } from '@/components/time';
import { useTheme } from '@/theme/theme';
import { snoozeOptions } from './inbox-state';
import { useConversation, useConversationUpdate } from './use-inbox';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <Label accessibilityRole="header">{title}</Label>
      {children}
    </View>
  );
}

/**
 * The customer behind a conversation: contact, their live visit and current page, cart items,
 * recent orders (each opens the order), and the conversation's assign, snooze and close actions.
 */
export function CustomerSheet({ id, now = new Date() }: { id: string; now?: Date }) {
  const { colors } = useTheme();
  const conversation = useConversation(id);
  const update = useConversationUpdate(id);
  const [snoozing, setSnoozing] = useState(false);
  const c = conversation.data;

  if (conversation.isPending) return <ActivityIndicator style={{ margin: space[6] }} />;
  if (!c)
    return (
      <Sheet>
        <EmptyState title="Couldn't load this" body={conversation.error?.message ?? 'Try again.'} />
      </Sheet>
    );

  const ctx = c.customerContext;
  const contact = ctx?.contact;
  const name = contact?.name ?? customerName(c.customer);
  const email = contact?.email ?? c.customer.email;
  const run = (patch: Parameters<typeof update.mutate>[0], done: string) =>
    update.mutate(patch, {
      onSuccess: () => setSnoozing(false),
      onError: (e) => Alert.alert(`Couldn't ${done}`, e.message),
    });

  return (
    <Sheet fill>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space[5], paddingBottom: space[2] }}>
        <View style={{ gap: space[1] }}>
          <Text size="title3" font="uiSemibold" accessibilityRole="header">
            {name}
          </Text>
          {email ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Email ${email}`}
              onPress={() => void Linking.openURL(`mailto:${email}`)}
            >
              <Text tone="accent">{email}</Text>
            </Pressable>
          ) : null}
          {contact?.phone ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Call ${contact.phone}`}
              onPress={() => void Linking.openURL(`tel:${contact.phone}`)}
            >
              <Text tone="accent">{contact.phone}</Text>
            </Pressable>
          ) : null}
          {ctx?.user ? (
            <Text size="footnote" tone="muted">
              Has an account
            </Text>
          ) : (
            <Text size="footnote" tone="muted">
              Guest
            </Text>
          )}
        </View>

        <ConversationActions
          detail={c}
          busy={update.isPending}
          snoozing={snoozing}
          onSnoozing={setSnoozing}
          now={now}
          run={run}
        />

        {ctx?.session ? (
          <Section title="On the store">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <Badge
                tone={ctx.session.online ? 'positive' : 'neutral'}
                label={ctx.session.online ? 'Online now' : 'Offline'}
              />
              <Text size="footnote" tone="muted">
                {ctx.session.online ? '' : `Seen ${timeAgo(ctx.session.lastSeenAt, now.getTime())} ago`}
              </Text>
            </View>
            {ctx.session.currentUrl && !/^https?:\/\//i.test(ctx.session.currentUrl) ? (
              // A path on the storefront: shown, not opened (the app doesn't know the storefront's host).
              <Text
                font="mono"
                size="footnote"
                accessibilityLabel={`Current page ${ctx.session.currentUrl}`}
                numberOfLines={2}
              >
                {ctx.session.currentUrl}
              </Text>
            ) : ctx.session.currentUrl ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Current page ${shortUrl(ctx.session.currentUrl)}`}
                onPress={() => void Linking.openURL(ctx.session?.currentUrl ?? '')}
              >
                <Text font="mono" size="footnote" tone="accent" numberOfLines={2}>
                  {shortUrl(ctx.session.currentUrl)}
                </Text>
              </Pressable>
            ) : null}
          </Section>
        ) : null}

        {ctx?.cart ? (
          <Section title={`Cart · ${ctx.cart.itemCount} ${ctx.cart.itemCount === 1 ? 'item' : 'items'}`}>
            {withKeys(ctx.cart.items, (x) => x.name).map(({ key, item }) => (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                {item.imageUrl ? (
                  <Image
                    source={{ uri: item.imageUrl }}
                    accessibilityIgnoresInvertColors
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
              accessibilityLabel={`Open cart ${ctx.cart.orderNumber}${ctx.cart.total ? `, ${formatMoney(ctx.cart.total)}` : ''}`}
              onPress={() => router.push(`/orders/${ctx.cart?.orderNumber ?? ''}`)}
            >
              <Text font="mono" tone="accent">
                {ctx.cart.orderNumber}
                {ctx.cart.total ? ` · ${formatMoney(ctx.cart.total)}` : ''} ›
              </Text>
            </Pressable>
          </Section>
        ) : null}

        <Section title="Recent orders">
          {ctx?.recentOrders.length ? (
            ctx.recentOrders.map((o) => (
              <Pressable
                key={o.number}
                accessibilityRole="link"
                accessibilityLabel={`Order ${o.number}${o.total ? `, ${formatMoney(o.total)}` : ''}${o.state ? `, ${o.state}` : ''}`}
                onPress={() => router.push(`/orders/${o.number}`)}
                style={({ pressed }) => [
                  styles.order,
                  { borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text font="monoMedium" style={{ flex: 1 }}>
                  {o.number}
                </Text>
                <Text size="footnote" tone="muted">
                  {[o.state, clockTime(o.completedAt, now)].filter(Boolean).join(' · ')}
                </Text>
                {o.total ? <Text font="mono">{formatMoney(o.total)}</Text> : null}
                <Text tone="muted">›</Text>
              </Pressable>
            ))
          ) : (
            <Text tone="muted">No orders yet.</Text>
          )}
        </Section>
      </ScrollView>
    </Sheet>
  );
}

/** Assign to me or unassign, snooze (1 hour, tomorrow, next week), close or reopen. */
function ConversationActions({
  detail: c,
  busy,
  snoozing,
  onSnoozing,
  now,
  run,
}: {
  detail: ConversationDetail;
  busy: boolean;
  snoozing: boolean;
  onSnoozing: (on: boolean) => void;
  now: Date;
  run: (
    patch: {
      id: string;
      status?: 'open' | 'snoozed' | 'closed';
      assignee?: 'me' | null;
      snoozedUntil?: string;
    },
    done: string,
  ) => void;
}) {
  const closed = c.status === 'closed';
  return (
    <Section title="Conversation">
      <Text size="footnote" tone="muted">
        {[
          c.assignee ? `Assigned to ${c.assignee.email ?? 'staff'}` : 'Unassigned',
          c.status === 'snoozed' && c.snoozedUntil ? `Snoozed until ${clockTime(c.snoozedUntil, now)}` : null,
          closed ? 'Closed' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {c.assignee ? (
          <Button
            size="small"
            variant="tonal"
            title="Unassign"
            disabled={busy}
            onPress={() => run({ id: c.id, assignee: null }, 'unassign it')}
          />
        ) : (
          <Button
            size="small"
            variant="tonal"
            title="Assign to me"
            disabled={busy}
            onPress={() => run({ id: c.id, assignee: 'me' }, 'assign it')}
          />
        )}
        {closed ? null : (
          <Button
            size="small"
            variant="tonal"
            title="Snooze"
            accessibilityState={{ expanded: snoozing }}
            disabled={busy}
            onPress={() => onSnoozing(!snoozing)}
          />
        )}
        {closed || c.status === 'snoozed' ? (
          <Button
            size="small"
            variant="tonal"
            title="Reopen"
            disabled={busy}
            onPress={() => run({ id: c.id, status: 'open' }, 'reopen it')}
          />
        ) : null}
        {closed ? null : (
          <Button
            size="small"
            variant="tonal"
            title="Close"
            disabled={busy}
            onPress={() => run({ id: c.id, status: 'closed' }, 'close it')}
          />
        )}
        {busy ? <ActivityIndicator accessibilityLabel="Saving" /> : null}
      </View>
      {snoozing ? (
        <View accessibilityRole="menu" accessibilityLabel="Snooze until" style={{ gap: space[2] }}>
          {snoozeOptions(now).map((o) => (
            <Button
              key={o.key}
              size="small"
              variant="plain"
              title={`${o.label} · ${clockTime(o.until.toISOString(), now)}`}
              accessibilityLabel={`Snooze for ${o.label.toLowerCase()}, until ${clockTime(o.until.toISOString(), now)}`}
              disabled={busy}
              onPress={() =>
                run({ id: c.id, status: 'snoozed', snoozedUntil: o.until.toISOString() }, 'snooze it')
              }
            />
          ))}
        </View>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 40, height: 40, borderRadius: radius.badge },
  order: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
