import { type Conversation, customerName } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/text';
import { timeAgo } from '@/components/time';
import { useTheme } from '@/theme/theme';

const CHANNELS: Record<string, string> = { web: 'Chat', email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };

/** "Chat", "Email", or the channel's own name. */
export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return 'Chat';
  return CHANNELS[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}

/** The preview line: the last message, "You:" for staff replies and "Note:" for notes. */
export function previewText(c: Conversation): string {
  const m = c.lastMessage;
  if (!m) return c.subject ?? 'No messages yet';
  const body = m.body.replace(/\s+/g, ' ').trim() || 'Attachment';
  if (m.direction === 'outbound') return `You: ${body}`;
  if (m.direction === 'note') return `Note: ${body}`;
  return body;
}

/** One conversation in the inbox list: who, the last message, when, unread count and assignee. */
export function ConversationRow({
  conversation: c,
  first,
  onPress,
  now = Date.now(),
}: {
  conversation: Conversation;
  first?: boolean;
  onPress: () => void;
  now?: number;
}) {
  const { colors } = useTheme();
  const name = customerName(c.customer);
  const when = timeAgo(c.lastMessage?.at ?? c.updatedAt, now);
  const unread = c.unread > 0;
  const label = [
    name,
    unread ? `${c.unread} unread` : null,
    previewText(c),
    when ? `${when === 'now' ? 'just now' : `${when} ago`}` : null,
    c.assignee ? `assigned to ${c.assignee.email ?? 'staff'}` : 'unassigned',
    c.status === 'snoozed' ? 'snoozed' : null,
    channelLabel(c.channel),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          opacity: pressed ? 0.7 : 1,
          borderTopColor: colors.line,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: unread ? colors.info : 'transparent' }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2] }}>
          <Text font={unread ? 'uiSemibold' : 'uiMedium'} numberOfLines={1} style={{ flex: 1 }}>
            {name}
          </Text>
          <Text size="footnote" tone="muted" font="mono">
            {when}
          </Text>
        </View>
        <Text size="footnote" tone={unread ? 'ink' : 'muted'} numberOfLines={2}>
          {previewText(c)}
        </Text>
        <Text size="caption" tone="muted" numberOfLines={1}>
          {[
            channelLabel(c.channel),
            c.assignee?.email ?? 'Unassigned',
            c.status === 'snoozed' ? 'Snoozed' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {unread ? (
        <View style={[styles.count, { backgroundColor: colors.info }]}>
          <Text size="caption" font="uiSemibold" style={{ color: colors.surface }}>
            {c.unread > 99 ? '99+' : c.unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: layout.gutter,
    paddingVertical: space[3],
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  count: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
