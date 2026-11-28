import { useLocalSearchParams } from 'expo-router';
import { SessionDetail } from '@/visitors/session-detail';

export default function VisitorSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SessionDetail id={id} />;
}
