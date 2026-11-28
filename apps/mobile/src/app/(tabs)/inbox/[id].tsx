import { useLocalSearchParams } from 'expo-router';
import { Chat } from '@/inbox/chat';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Chat id={id} />;
}
