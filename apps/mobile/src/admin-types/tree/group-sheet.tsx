import type { AdminRecord, AdminResource } from '@instincts/spree-domain';
import { space } from '@instincts/spree-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { Button, EmptyState, Sheet, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useTRPC } from '@/trpc/trpc';
import { singularLabel } from '../values';
import { useTreeGroups } from './use-tree';

type MutationError = { message: string };

function GroupRow({
  record,
  groupType,
  onRename,
  onDelete,
  busy,
}: {
  record: AdminRecord;
  groupType: AdminResource;
  onRename: (name: string) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(record.title);
  const changed = name.trim() !== record.title && !!name.trim();
  const canRename = groupType.update && record.can.update;
  return (
    <View style={{ gap: space[2] }}>
      {canRename ? (
        <TextField
          label={`${singularLabel(groupType)} name`}
          value={name}
          onChangeText={setName}
          returnKeyType="done"
          onSubmitEditing={() => changed && onRename(name.trim())}
        />
      ) : (
        <Text font="uiSemibold">{record.title}</Text>
      )}
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        {canRename ? (
          <Button
            size="small"
            variant="tonal"
            title="Rename"
            disabled={!changed || busy}
            accessibilityLabel={`Rename ${record.title}`}
            onPress={() => onRename(name.trim())}
          />
        ) : null}
        {groupType.destroy && record.can.destroy ? (
          <Button
            size="small"
            variant="destructive"
            title="Delete"
            disabled={busy}
            accessibilityLabel={`Delete ${record.title}`}
            onPress={onDelete}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * Add, rename and delete a tree view's groups (menu locations) from the tree screen. The group type
 * is usually hidden from More (gem 0.7), and hidden types still take these writes. Its title field
 * is the name.
 */
export function GroupSheet({ groupType }: { groupType: AdminResource }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const groups = useTreeGroups(groupType);
  const [name, setName] = useState('');
  const changed = () => {
    void qc.invalidateQueries(trpc.resources.list.pathFilter());
    void qc.invalidateQueries(trpc.resources.tree.pathFilter());
  };
  const single = singularLabel(groupType).toLowerCase();
  const create = useMutation(
    trpc.resources.create.mutationOptions({
      onSuccess: () => {
        setName('');
        changed();
      },
      onError: (e: MutationError) => Alert.alert(`Couldn't add the ${single}`, e.message),
    }),
  );
  const update = useMutation(
    trpc.resources.update.mutationOptions({
      onSuccess: changed,
      onError: (e: MutationError) => Alert.alert(`Couldn't rename the ${single}`, e.message),
    }),
  );
  const remove = useMutation(
    trpc.resources.remove.mutationOptions({
      onSuccess: changed,
      onError: (e: MutationError) => Alert.alert(`Couldn't delete the ${single}`, e.message),
    }),
  );
  const busy = create.isPending || update.isPending || remove.isPending;
  const list = groups.data?.items ?? [];

  return (
    <Sheet fill>
      <Text size="title3" font="uiSemibold" accessibilityRole="header">
        {groupType.label}
      </Text>
      {groups.isPending ? (
        <ActivityIndicator />
      ) : groups.error ? (
        <EmptyState title={`Couldn't load ${groupType.label.toLowerCase()}`} body={groups.error.message} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space[4] }}>
          {list.map((record) => (
            <GroupRow
              key={`${record.id}:${record.title}`}
              record={record}
              groupType={groupType}
              busy={busy}
              onRename={(title) =>
                update.mutate({
                  key: groupType.key,
                  id: record.id,
                  values: { [groupType.titleField]: title },
                  ...(record.version !== null ? { version: record.version } : {}),
                })
              }
              onDelete={() =>
                Alert.alert(
                  `Delete “${record.title}”?`,
                  'Its menu items may be deleted too. This can’t be undone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => remove.mutate({ key: groupType.key, id: record.id }),
                    },
                  ],
                )
              }
            />
          ))}
          {!list.length ? <Text tone="muted">None yet.</Text> : null}
        </ScrollView>
      )}
      {groupType.create ? (
        <View style={{ gap: space[2] }}>
          <TextField
            label={`New ${single}`}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={() =>
              name.trim() &&
              create.mutate({ key: groupType.key, values: { [groupType.titleField]: name.trim() } })
            }
          />
          <Button
            title={`Add ${single}`}
            variant="tonal"
            loading={create.isPending}
            disabled={!name.trim() || busy}
            onPress={() =>
              create.mutate({ key: groupType.key, values: { [groupType.titleField]: name.trim() } })
            }
          />
        </View>
      ) : null}
    </Sheet>
  );
}
