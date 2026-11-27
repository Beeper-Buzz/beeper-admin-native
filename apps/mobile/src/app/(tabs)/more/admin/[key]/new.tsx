import { space } from '@instincts/spree-ui';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { RecordForm } from '@/admin-types/record-form';
import { useAdminType } from '@/admin-types/use-admin-types';
import { singular } from '@/admin-types/values';
import { EmptyState, Screen } from '@/components/primitives';

/** A new record of a host-described admin type, with the same form as editing one. */
export default function NewAdminRecordScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { type, data, isPending, error } = useAdminType(key);
  if (isPending)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: space[8] }} />
      </Screen>
    );
  if (!type?.create)
    return (
      <Screen>
        <EmptyState
          title="Can't add one here"
          body={error?.message ?? "This store doesn't allow adding these from the app."}
        />
      </Screen>
    );
  return (
    <Screen>
      <Stack.Screen options={{ title: `New ${singular(type.label).toLowerCase()}` }} />
      <RecordForm type={type} record={null} types={data ?? []} />
    </Screen>
  );
}
