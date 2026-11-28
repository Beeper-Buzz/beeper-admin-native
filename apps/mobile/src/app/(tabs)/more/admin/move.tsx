import { space } from '@instincts/spree-ui';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { MoveSheet } from '@/admin-types/tree/move-sheet';
import { useAdminType } from '@/admin-types/use-admin-types';
import { EmptyState, Sheet } from '@/components/primitives';

/** Form sheet: move a menu builder node to a parent and position. */
export default function MoveNodeSheet() {
  const { key, id, group } = useLocalSearchParams<{ key: string; id: string; group?: string }>();
  const { type, isPending } = useAdminType(key);
  if (isPending) return <ActivityIndicator style={{ margin: space[6] }} />;
  if (!type)
    return (
      <Sheet>
        <EmptyState title="Not available" body="This store doesn't offer this admin type any more." />
      </Sheet>
    );
  return <MoveSheet type={type} id={id} group={group || null} />;
}
