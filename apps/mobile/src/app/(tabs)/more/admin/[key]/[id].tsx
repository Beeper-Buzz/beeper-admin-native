import { space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { RecordForm } from '@/admin-types/record-form';
import { useAdminType } from '@/admin-types/use-admin-types';
import { EmptyState, Screen } from '@/components/primitives';
import { useTRPC } from '@/trpc/trpc';

/** One record of a host-described admin type: its fields, Save, actions and Delete. */
export default function AdminRecordScreen() {
  const { key, id } = useLocalSearchParams<{ key: string; id: string }>();
  const trpc = useTRPC();
  const types = useAdminType(key);
  const record = useQuery(trpc.resources.get.queryOptions({ key, id }));

  if (types.isPending || record.isPending)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: space[8] }} />
      </Screen>
    );
  if (!types.type || !record.data)
    return (
      <Screen>
        <EmptyState
          title="Couldn't load this"
          body={
            record.error?.message ??
            types.error?.message ??
            "This store doesn't offer this admin type any more."
          }
        />
      </Screen>
    );
  return (
    <Screen>
      <Stack.Screen options={{ title: record.data.title }} />
      <RecordForm type={types.type} record={record.data} types={types.types ?? []} />
    </Screen>
  );
}
