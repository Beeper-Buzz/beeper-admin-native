import { space } from '@instincts/spree-ui';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { ActionForm } from '@/admin-types/action-form';
import { useAdminType } from '@/admin-types/use-admin-types';
import { EmptyState, Sheet } from '@/components/primitives';

/** Form sheet for a member action that asks for inputs before it runs (gem 0.5). */
export default function AdminActionSheet() {
  const { key, id, action, request } = useLocalSearchParams<{
    key: string;
    id: string;
    action: string;
    request: string;
  }>();
  const { type, types, isPending } = useAdminType(key);
  const found = type?.actions.find((a) => a.name === action);
  if (!type || !found)
    return (
      <Sheet>
        {isPending ? (
          <ActivityIndicator style={{ margin: space[4] }} />
        ) : (
          <EmptyState title="Not available" body="This store doesn't offer this action any more." />
        )}
      </Sheet>
    );
  return <ActionForm type={type} action={found} recordId={id} request={request} types={types ?? []} />;
}
