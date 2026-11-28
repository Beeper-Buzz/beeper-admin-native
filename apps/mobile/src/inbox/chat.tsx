import { customerName, type Message } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { router, Stack } from 'expo-router';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, Screen } from '@/components/primitives';
import { Text } from '@/components/text';
import { useKeyboardVisible } from '@/components/use-keyboard-visible';
import { Composer } from './composer';
import { MessageBubble } from './message-bubble';
import { useConversation, useMessages } from './use-inbox';

/**
 * A conversation as a chat: an inverted list (newest at the bottom, older ones loading as you
 * scroll up), the composer, and a header button for the customer sheet. New messages are polled
 * every 5 s while the screen is in front and the app in the foreground.
 */
export function Chat({ id }: { id: string }) {
  const conversation = useConversation(id);
  const messages = useMessages(id);
  const keyboard = useKeyboardVisible();
  const c = conversation.data;
  const name = c ? customerName(c.customer) : '';
  // Inverted: the newest message first in the data is drawn at the bottom.
  const data: Message[] = [...messages.messages].reverse();
  const closed = c?.status === 'closed';

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`About ${name || 'this customer'}`}
              accessibilityHint="Contact, cart, orders, assign, snooze and close"
              hitSlop={8}
              onPress={() => router.push({ pathname: '/inbox/customer', params: { id } })}
            >
              <Text font="uiSemibold" tone="accent">
                Customer
              </Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        {messages.isPending ? (
          <ActivityIndicator accessibilityLabel="Loading messages" style={{ marginTop: space[8] }} />
        ) : messages.error ? (
          <EmptyState title="Couldn't load the messages" body={messages.error.message} />
        ) : (
          <FlatList
            inverted
            data={data}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageBubble message={item} />}
            contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingVertical: space[3] }}
            onEndReached={() => void messages.loadOlder()}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              messages.loadingOlder ? (
                <ActivityIndicator
                  accessibilityLabel="Loading earlier messages"
                  style={{ margin: space[3] }}
                />
              ) : undefined
            }
            ListEmptyComponent={
              <View style={{ transform: [{ scaleY: -1 }] }}>
                <EmptyState title="No messages yet" body="Write the first one below." />
              </View>
            }
          />
        )}
        {/* The tab bar floats over the screen, so the composer sits above it (the view's bottom safe
            area includes the tab bar). With the keyboard up the tab bar is hidden behind it, and the
            composer rests on the keyboard instead. */}
        <SafeAreaView edges={keyboard ? [] : ['bottom']}>
          {closed ? (
            <Text size="footnote" tone="muted" style={{ textAlign: 'center', paddingVertical: space[1] }}>
              This conversation is closed. Reopen it from Customer.
            </Text>
          ) : null}
          <Composer conversationId={id} onSent={(m) => messages.add([m])} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
