import { useLocalSearchParams } from 'expo-router';
import { CustomerSheet } from '@/inbox/customer-sheet';

/** Form sheet: the customer behind a conversation, and its assign, snooze and close actions. */
export default function ConversationCustomerSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CustomerSheet id={id} />;
}
