import type { Message, MessageAttachment } from '@instincts/spree-domain';
import { radius, space } from '@instincts/spree-ui';
import { Image } from 'expo-image';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/text';
import { clockTime } from '@/components/time';
import { useTheme } from '@/theme/theme';
import { channelLabel } from './conversation-row';

const isImage = (a: MessageAttachment) =>
  (a.contentType ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp|heic)$/i.test(a.filename);

/** Who wrote it and how it went out, for the line under the bubble and screen readers. */
export function messageMeta(m: Message, now = new Date()): string {
  const who =
    m.direction === 'note'
      ? `Note by ${m.author.name ?? 'staff'}`
      : m.direction === 'inbound'
        ? (m.author.name ?? 'Customer')
        : (m.author.name ?? 'You');
  const delivery =
    m.direction === 'outbound' && m.delivery === 'failed'
      ? 'Not delivered'
      : m.direction === 'outbound' && m.channel && m.channel !== 'web'
        ? `by ${channelLabel(m.channel).toLowerCase()}`
        : null;
  return [who, clockTime(m.createdAt, now), delivery].filter(Boolean).join(' · ');
}

/**
 * One chat message. Customer messages sit on the left, staff replies on the right in the accent
 * colour, and internal notes on the right with a dashed outline and a "Note" label, so they never
 * read as something the customer saw.
 */
export function MessageBubble({ message: m }: { message: Message }) {
  const { colors } = useTheme();
  const inbound = m.direction === 'inbound';
  const note = m.direction === 'note';
  const failed = m.direction === 'outbound' && m.delivery === 'failed';
  const background = inbound ? colors.surface : note ? colors.surfaceSunk : colors.accent;
  const ink = inbound || note ? colors.ink : colors.onAccent;
  const meta = messageMeta(m);
  return (
    <View
      // Read as one, unless it has attachments to open.
      accessible={!m.attachments.length}
      accessibilityLabel={`${note ? 'Internal note. ' : ''}${meta}. ${m.body}${
        m.attachments.length
          ? `. ${m.attachments.length} attachment${m.attachments.length === 1 ? '' : 's'}`
          : ''
      }`}
      style={[styles.wrap, { alignItems: inbound ? 'flex-start' : 'flex-end' }]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: background,
            borderColor: note ? colors.attention : failed ? colors.critical : colors.line,
            borderStyle: note ? 'dashed' : 'solid',
            borderWidth: inbound || note || failed ? 1 : 0,
            borderBottomLeftRadius: inbound ? 4 : radius.card,
            borderBottomRightRadius: inbound ? radius.card : 4,
          },
        ]}
      >
        {note ? (
          <Text size="caption" font="uiSemibold" tone="attention">
            Note · only staff see this
          </Text>
        ) : null}
        {m.body ? (
          <Text selectable style={{ color: ink }}>
            {m.body}
          </Text>
        ) : null}
        {m.attachments.map((a) =>
          isImage(a) ? (
            <Pressable
              key={a.url}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Open ${a.filename}`}
              onPress={() => void Linking.openURL(a.url)}
            >
              <Image source={{ uri: a.url }} contentFit="cover" style={styles.image} />
            </Pressable>
          ) : (
            <Pressable
              key={a.url}
              accessibilityRole="link"
              accessibilityLabel={`Open ${a.filename}`}
              onPress={() => void Linking.openURL(a.url)}
            >
              <Text style={{ color: ink, textDecorationLine: 'underline' }} numberOfLines={1}>
                📎 {a.filename}
              </Text>
            </Pressable>
          ),
        )}
      </View>
      <Text size="caption" tone={failed ? 'critical' : 'muted'} style={{ paddingHorizontal: space[1] }}>
        {meta}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, marginVertical: space[1] },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.card,
    gap: space[1],
  },
  image: { width: 200, height: 150, borderRadius: radius.badge },
});
