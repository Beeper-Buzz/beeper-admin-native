import { space } from '@instincts/spree-ui';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { GroupSheet } from '@/admin-types/tree/group-sheet';
import { treeGroup } from '@/admin-types/tree/tree-type';
import { useAdminType } from '@/admin-types/use-admin-types';
import { EmptyState, Sheet } from '@/components/primitives';

/** Form sheet: the groups (menu locations) of a tree-view type. */
export default function TreeGroupsSheet() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { type, types, isPending } = useAdminType(key);
  if (isPending) return <ActivityIndicator style={{ margin: space[6] }} />;
  const groupType = type ? treeGroup(type, types ?? []).groupType : null;
  if (!groupType)
    return (
      <Sheet>
        <EmptyState title="Not available" body="This store doesn't describe these groups to the app." />
      </Sheet>
    );
  return <GroupSheet groupType={groupType} />;
}
