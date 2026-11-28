import type { Message } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useMutation } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Text } from '@/components/text';
import { pickPhoto } from '@/media/pick';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

/** The spec's message length limit (§5). */
export const MAX_MESSAGE = 4000;

interface Pending {
  signedId: string;
  uri: string;
  name: string;
}

/**
 * Write a reply or an internal note, with photos from the library uploaded through the store's
 * existing uploads. Send is off until there is text or a photo; both stay when sending fails.
 */
export function Composer({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: (m: Message) => void;
}) {
  const trpc = useTRPC();
  const { colors, fonts } = useTheme();
  const [body, setBody] = useState('');
  const [note, setNote] = useState(false);
  const [photos, setPhotos] = useState<Pending[]>([]);
  const upload = useMutation(trpc.inbox.upload.mutationOptions());
  const [picking, setPicking] = useState(false);
  const reply = useMutation(
    trpc.inbox.reply.mutationOptions({
      onSuccess: (message) => {
        setBody('');
        setPhotos([]);
        setNote(false);
        onSent(message);
      },
      onError: (e) => Alert.alert(note ? "Couldn't save the note" : "Couldn't send", e.message),
    }),
  );
  const busy = picking || upload.isPending;

  const attach = async () => {
    setPicking(true);
    try {
      const picked = await pickPhoto('library');
      if (picked.status === 'denied') {
        Alert.alert(
          'No access to your photos',
          picked.canAskAgain
            ? 'Allow access to your photos to attach one.'
            : 'Allow access to your photos in Settings to attach one.',
          picked.canAskAgain
            ? [{ text: 'OK' }]
            : [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Settings', onPress: () => void Linking.openSettings() },
              ],
        );
        return;
      }
      if (picked.status !== 'picked') return;
      const blob = await upload.mutateAsync({ file: picked.photo });
      setPhotos((p) => [...p, { signedId: blob.signedId, uri: picked.photo.uri, name: blob.filename }]);
    } catch (e) {
      Alert.alert("Couldn't attach the photo", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setPicking(false);
    }
  };

  const text = body.trim();
  const empty = !text && !photos.length;
  const send = () => {
    if ((!text && !photos.length) || reply.isPending || busy) return;
    reply.mutate({
      id: conversationId,
      body: text,
      note,
      attachments: photos.map((p) => p.signedId),
    });
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          borderTopColor: colors.line,
          backgroundColor: note ? colors.surfaceSunk : colors.bg,
        },
      ]}
    >
      {photos.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {photos.map((p) => (
            <View key={p.signedId}>
              <Image
                source={{ uri: p.uri }}
                accessibilityLabel={`Attached photo ${p.name}`}
                style={styles.thumb}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${p.name}`}
                hitSlop={8}
                onPress={() => setPhotos((all) => all.filter((x) => x.signedId !== p.signedId))}
                style={[styles.remove, { backgroundColor: colors.ink }]}
              >
                <Text size="caption" style={{ color: colors.bg }}>
                  ✕
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Switch
          accessibilityLabel="Internal note"
          accessibilityHint="Only staff see notes; they are never sent to the customer"
          value={note}
          onValueChange={setNote}
        />
        <Text size="footnote" tone={note ? 'attention' : 'muted'} style={{ flex: 1 }}>
          {note ? 'Note: only staff will see this' : 'Reply to the customer'}
        </Text>
        {body.length > MAX_MESSAGE - 200 ? (
          <Text size="caption" tone={body.length > MAX_MESSAGE ? 'critical' : 'muted'} font="mono">
            {body.length}/{MAX_MESSAGE}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[2] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach a photo"
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={() => void attach()}
          style={({ pressed }) => [styles.icon, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator />
          ) : (
            <Text size="title3" tone="accent">
              ＋
            </Text>
          )}
        </Pressable>
        <TextInput
          accessibilityLabel={note ? 'Note' : 'Message'}
          placeholder={note ? 'Write a note for your team' : 'Write a reply'}
          placeholderTextColor={colors.inkMuted}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={MAX_MESSAGE}
          style={[
            styles.input,
            {
              color: colors.ink,
              backgroundColor: colors.surface,
              borderColor: note ? colors.attention : colors.line,
              fontFamily: fonts.ui,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={note ? 'Save note' : 'Send'}
          accessibilityState={{ disabled: empty || busy || reply.isPending, busy: reply.isPending }}
          disabled={empty || busy || reply.isPending}
          onPress={send}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: note ? colors.attention : colors.accent,
              opacity: empty || busy ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {reply.isPending ? (
            <ActivityIndicator color={note ? colors.surface : colors.onAccent} />
          ) : (
            <Text font="uiSemibold" style={{ color: note ? colors.surface : colors.onAccent }}>
              {note ? 'Save' : 'Send'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: layout.gutter,
    paddingVertical: space[2],
    gap: space[2],
  },
  input: {
    flex: 1,
    minHeight: layout.hitTarget,
    maxHeight: 140,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space[3],
    paddingTop: space[2],
    paddingBottom: space[2],
    fontSize: 16,
  },
  icon: { width: layout.hitTarget, height: layout.hitTarget, alignItems: 'center', justifyContent: 'center' },
  send: {
    minHeight: layout.hitTarget,
    paddingHorizontal: space[4],
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 56, height: 56, borderRadius: radius.badge },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
