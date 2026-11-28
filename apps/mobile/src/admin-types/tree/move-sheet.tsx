import type { AdminResource } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Button, EmptyState, Sheet } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useTheme } from '@/theme/theme';
import { findNode, parentChoices, placementOf } from './tree-ops';
import { useTree, useTreeActions } from './use-tree';
import { INDENT } from './use-tree-drag';

function Choice({
  label,
  selected,
  depth = 0,
  onPress,
}: {
  label: string;
  selected: boolean;
  depth?: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: layout.hitTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        paddingLeft: depth * INDENT,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ width: 20, color: colors.accentInk }}>{selected ? '✓' : ''}</Text>
      <Text style={{ flex: 1 }} font={selected ? 'uiSemibold' : 'ui'} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The accessible way to move a node: pick the parent (the top level, or any item outside its own
 * subtree), then where among that parent's items, then Move. The move is shown at once and saved
 * with the same `PATCH tree` as a drag.
 */
export function MoveSheet({ type, id, group }: { type: AdminResource; id: string; group: string | null }) {
  const tree = useTree(type.key, group);
  const actions = useTreeActions(type, group);
  const nodes = tree.data?.nodes ?? [];
  const node = findNode(nodes, id);
  const now = placementOf(nodes, id);
  const [parentId, setParentId] = useState<string | null | undefined>(undefined);
  const [position, setPosition] = useState<number | undefined>(undefined);
  const parent = parentId === undefined ? (now?.parentId ?? null) : parentId;
  const siblings = (parent === null ? nodes : (findNode(nodes, parent)?.children ?? [])).filter(
    (n) => n.id !== id,
  );
  const at =
    position !== undefined
      ? Math.min(position, siblings.length)
      : parent === (now?.parentId ?? null)
        ? (now?.position ?? 0)
        : siblings.length;

  if (tree.isPending) return <ActivityIndicator style={{ margin: space[6] }} />;
  if (!node || !now)
    return (
      <Sheet>
        <EmptyState title="Can't move this" body={tree.error?.message ?? 'It is no longer in this menu.'} />
      </Sheet>
    );
  const unchanged = parent === now.parentId && at === now.position;

  return (
    <Sheet>
      <Text size="title3" font="uiSemibold" accessibilityRole="header">
        Move “{node.title}”
      </Text>
      <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: space[3] }}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Put it under" style={{ gap: 2 }}>
          <Label>Under</Label>
          {parentChoices(nodes, id).map((c) => (
            <Choice
              key={c.id ?? 'top'}
              label={c.title}
              depth={c.depth}
              selected={parent === c.id}
              onPress={() => {
                setParentId(c.id);
                setPosition(undefined);
              }}
            />
          ))}
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Position" style={{ gap: 2 }}>
          <Label>Position</Label>
          <Choice label="First" selected={at === 0} onPress={() => setPosition(0)} />
          {siblings.map((s, i) => (
            <Choice
              key={s.id}
              label={`After “${s.title}”`}
              selected={at === i + 1}
              onPress={() => setPosition(i + 1)}
            />
          ))}
        </View>
      </ScrollView>
      <Button
        title="Move"
        disabled={unchanged}
        onPress={() => {
          if (actions.moveTo(id, { parentId: parent, position: at })) router.back();
        }}
      />
    </Sheet>
  );
}
