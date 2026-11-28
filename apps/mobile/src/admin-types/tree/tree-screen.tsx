import type { AdminResource, AdminTreeNode } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { FilterChips } from '@/components/filter-chips';
import { Button, EmptyState, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useTheme } from '@/theme/theme';
import { singularLabel } from '../values';
import { availableSteps, findNode, flatten, type Placement, stepPlacement } from './tree-ops';
import { STEP_LABELS, TreeRow } from './tree-row';
import { treeGroup, treeView } from './tree-type';
import { addPrefill, useTree, useTreeActions, useTreeGroups } from './use-tree';
import { INDENT, useTreeDrag } from './use-tree-drag';

/** Where an inline add puts the new node, and the row it shows above (null: at the end). */
interface Adding {
  at: Placement;
  beforeId: string | null;
  depth: number;
}

/** The row an inline add at `at` shows above: the sibling now at that position, else what follows the parent's subtree. */
export function addingRow(nodes: readonly AdminTreeNode[], at: Placement): Adding {
  const flat = flatten(nodes);
  const parent = at.parentId ? flat.find((f) => f.id === at.parentId) : null;
  const depth = parent ? parent.depth + 1 : 0;
  const siblings = flat.filter((f) => f.parentId === at.parentId);
  const sibling = siblings[at.position];
  if (sibling) return { at, beforeId: sibling.id, depth };
  // After the parent's last descendant: the next row at the parent's depth or shallower.
  const start = parent ? flat.indexOf(parent) : -1;
  const next = parent ? flat.slice(start + 1).find((f) => f.depth <= parent.depth) : undefined;
  return { at, beforeId: next?.id ?? null, depth };
}

/**
 * The menu builder (gem 0.7 tree views): tabs of groups (menu locations), the nested list with
 * drag to reorder and indent, row menus (move up and down, indent, outdent, the Move sheet, add a
 * child or a sibling, delete), inline add, tap to edit in the record form, and a visibility switch.
 * Every move shows at once and is saved with one `PATCH tree`; a refused move is undone.
 */
export function TreeScreen({ type, types }: { type: AdminResource; types: readonly AdminResource[] }) {
  const { colors } = useTheme();
  const view = treeView(type);
  const { groupType } = treeGroup(type, types);
  const groups = useTreeGroups(groupType);
  const groupList = groups.data?.items ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const group = groupType ? (groupList.find((g) => g.id === chosen) ?? groupList[0] ?? null) : null;
  const groupId = group?.id ?? null;
  // A view with groups waits for them; without a known group type, the whole table is one tree.
  const waitingForGroups = !!groupType && (groups.isPending || (!!groupList.length && !group));
  const tree = useTree(type.key, groupId, !waitingForGroups && (!groupType || !!group));
  const nodes = tree.data?.nodes ?? [];
  const actions = useTreeActions(type, groupId);
  const editable = type.update;
  const drag = useTreeDrag(nodes, (id, at) => void actions.moveTo(id, at));
  const [menuFor, setMenuFor] = useState<AdminTreeNode | null>(null);
  // An add belongs to the group it was started in; switching groups drops it.
  const [addingIn, setAddingIn] = useState<(Adding & { group: string | null }) | null>(null);
  const adding = addingIn && addingIn.group === groupId ? addingIn : null;
  const setAdding = (a: Adding | null) => setAddingIn(a ? { ...a, group: groupId } : null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const flat = flatten(nodes);
  const lifted = drag.dragging ? findNode(nodes, drag.dragging) : null;
  const liftedIds = new Set(lifted ? flatten([lifted]).map((f) => f.id) : []);
  const single = singularLabel(type).toLowerCase();

  const startAdd = (at: Placement) => {
    setTitle('');
    setAdding(addingRow(nodes, at));
  };
  const openNew = (text: string, at: Placement) => {
    const parent = at.parentId ? findNode(nodes, at.parentId) : null;
    const prefill = addPrefill(
      type,
      text,
      group ? { id: group.id, title: group.title } : null,
      parent ? { id: parent.id, title: parent.title } : null,
    );
    router.push({
      pathname: '/more/admin/[key]/new',
      params: { key: type.key, prefill: JSON.stringify(prefill) },
    });
  };
  const submitAdd = async () => {
    if (!adding) return;
    const text = title.trim();
    if (!text) return setAdding(null);
    setSaving(true);
    const result = await actions.add(text, adding.at);
    setSaving(false);
    if (result.ok) {
      setAdding(null);
      setTitle('');
      return;
    }
    // The store wants more than a title (a link, say): finish it in the full form.
    const kind = (result.error as { data?: { spreeKind?: string | null } } | null)?.data?.spreeKind;
    if (kind === 'invalid') {
      setAdding(null);
      openNew(text, adding.at);
    } else Alert.alert(`Couldn't add the ${single}`, (result.error as Error)?.message ?? 'Try again.');
  };

  const edit = (node: AdminTreeNode) =>
    router.push({ pathname: '/more/admin/[key]/[id]', params: { key: type.key, id: node.id } });
  const step = (node: AdminTreeNode, s: Parameters<typeof stepPlacement>[2]) => {
    const at = stepPlacement(nodes, node.id, s);
    if (at) actions.moveTo(node.id, at);
  };
  const moveSheet = (node: AdminTreeNode) =>
    router.push({
      pathname: '/more/admin/move',
      params: { key: type.key, id: node.id, group: groupId ?? '' },
    });
  const confirmDelete = (node: AdminTreeNode) =>
    Alert.alert(
      `Delete “${node.title}”?`,
      node.children.length
        ? 'What is inside it may be deleted too. This can’t be undone.'
        : 'This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => actions.remove.mutate(node) },
      ],
    );

  const menu: MenuAction[] = menuFor
    ? [
        { key: 'edit', label: 'Edit', onPress: () => edit(menuFor) },
        ...(type.create
          ? [
              {
                key: 'child',
                label: `Add ${single} inside`,
                onPress: () => startAdd({ parentId: menuFor.id, position: menuFor.children.length }),
              },
              {
                key: 'sibling',
                label: `Add ${single} below`,
                onPress: () => {
                  const f = flat.find((x) => x.id === menuFor.id);
                  if (f) startAdd({ parentId: f.parentId, position: f.index + 1 });
                },
              },
            ]
          : []),
        ...(editable
          ? [
              ...availableSteps(nodes, menuFor.id).map((s) => ({
                key: s,
                label: STEP_LABELS[s],
                onPress: () => step(menuFor, s),
              })),
              { key: 'move', label: 'Move to…', onPress: () => moveSheet(menuFor) },
            ]
          : []),
        ...(type.destroy && menuFor.can.destroy
          ? [{ key: 'delete', label: 'Delete', destructive: true, onPress: () => confirmDelete(menuFor) }]
          : []),
      ]
    : [];

  const inlineAdd = (a: Adding) => (
    <View
      key="adding"
      style={{
        paddingLeft: layout.gutter + a.depth * INDENT + (editable ? 32 : 0),
        paddingRight: layout.gutter,
        paddingVertical: space[2],
        gap: space[2],
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <TextField
        label={`New ${single}`}
        value={title}
        onChangeText={setTitle}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void submitAdd()}
        editable={!saving}
      />
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Button size="small" title="Add" loading={saving} onPress={() => void submitAdd()} />
        <Button
          size="small"
          variant="plain"
          title="Cancel"
          disabled={saving}
          onPress={() => setAdding(null)}
        />
        <Button
          size="small"
          variant="plain"
          title="More fields…"
          disabled={saving}
          accessibilityHint="Opens the full form"
          onPress={() => {
            setAdding(null);
            openNew(title.trim(), a.at);
          }}
        />
      </View>
    </View>
  );

  const body = () => {
    if (waitingForGroups || (tree.isPending && tree.fetchStatus !== 'idle'))
      return (
        <ActivityIndicator
          accessibilityLabel={`Loading ${type.label.toLowerCase()}`}
          style={{ marginTop: space[8] }}
        />
      );
    if (groups.error)
      return (
        <EmptyState title={`Couldn't load ${groupType?.label.toLowerCase()}`} body={groups.error.message} />
      );
    if (groupType && !groupList.length)
      return (
        <EmptyState
          title={`No ${groupType.label.toLowerCase()} yet`}
          body={
            groupType.create
              ? `Add one to start building ${type.label.toLowerCase()}.`
              : 'Add one in the store first.'
          }
        />
      );
    if (tree.error)
      return <EmptyState title={`Couldn't load ${type.label.toLowerCase()}`} body={tree.error.message} />;
    const rows = flat.map((f) => (
      <View key={f.id}>
        {adding?.beforeId === f.id ? inlineAdd(adding) : null}
        <TreeRow
          node={f.node}
          depth={f.depth}
          position={f.index + 1}
          siblings={f.siblings}
          steps={editable ? availableSteps(nodes, f.id) : []}
          visible={actions.visibility ? f.node.values[actions.visibility.name] !== false : undefined}
          onToggleVisible={(on) => actions.toggle.mutate({ node: f.node, on })}
          onEdit={() => edit(f.node)}
          onMenu={() => setMenuFor(f.node)}
          onStep={(s) => step(f.node, s)}
          onMoveSheet={() => moveSheet(f.node)}
          pan={editable && f.node.can.update ? drag.handleFor(f.id) : null}
          lifted={drag.dragging === f.id}
          dimmed={drag.dragging !== f.id && liftedIds.has(f.id)}
          dy={drag.dy}
          onLayout={drag.onRowLayout(f.id)}
        />
      </View>
    ));
    return (
      <View>
        {rows}
        {adding && adding.beforeId === null ? inlineAdd(adding) : null}
        {drag.preview?.placement ? (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              top: drag.preview.y - 1,
              left: layout.gutter + drag.preview.depth * INDENT,
              right: layout.gutter,
              height: 3,
              borderRadius: 2,
              backgroundColor: colors.accent,
            }}
          />
        ) : null}
        {!flat.length && !adding ? (
          <EmptyState
            title="Nothing here yet"
            body={type.create ? `Add the first ${single}.` : 'Items added in the store appear here.'}
          />
        ) : null}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: type.label }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!drag.dragging}
        contentContainerStyle={{ paddingBottom: space[8] }}
        refreshControl={
          <RefreshControl
            refreshing={tree.isRefetching}
            onRefresh={() => {
              void tree.refetch();
              void groups.refetch();
            }}
          />
        }
      >
        {groupType ? (
          <View>
            {groupList.length ? (
              <FilterChips
                options={groupList.map((g) => [g.id, g.title] as const)}
                value={groupId ?? ''}
                onChange={setChosen}
              />
            ) : null}
            <View style={{ flexDirection: 'row', paddingHorizontal: layout.gutter, paddingBottom: space[2] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityHint={`Add, rename or delete ${groupType.label.toLowerCase()}`}
                onPress={() =>
                  router.push({
                    pathname: '/more/admin/groups',
                    params: { key: type.key, group: groupId ?? '' },
                  })
                }
                hitSlop={8}
              >
                <Text size="footnote" font="uiSemibold" tone="accent">
                  Edit {groupType.label.toLowerCase()}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : view?.group ? (
          <Text
            size="footnote"
            tone="muted"
            style={{ paddingHorizontal: layout.gutter, paddingBottom: space[2] }}
          >
            Showing every group: this store doesn't describe its groups to the app.
          </Text>
        ) : null}
        {body()}
        {type.create && !waitingForGroups && (!groupType || group) && !tree.error ? (
          <View style={{ padding: layout.gutter }}>
            <Button
              title={`Add ${single}`}
              variant="tonal"
              disabled={!!adding}
              onPress={() => startAdd({ parentId: null, position: nodes.length })}
            />
          </View>
        ) : null}
        {editable && flat.length > 1 ? (
          <Text size="footnote" tone="muted" style={{ paddingHorizontal: layout.gutter }}>
            Drag ≡ to reorder; drag right or left to nest. The ••• menu moves items one step at a time.
          </Text>
        ) : null}
      </ScrollView>
      <ActionMenu
        visible={!!menuFor}
        title={menuFor?.title ?? ''}
        actions={menu}
        onClose={() => setMenuFor(null)}
      />
    </>
  );
}
