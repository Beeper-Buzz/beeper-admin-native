import type { AdminRecord, AdminResource, AdminTree, AdminTreeNode } from '@instincts/spree-domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { useTRPC, useTRPCClient } from '@/trpc/trpc';
import { findNode, insertNode, moveNode, type Placement, treeMoves, updateNode } from './tree-ops';
import { treeView, visibilityField } from './tree-type';

/** The groups (menu locations) of a tree view, in the host's order. */
export function useTreeGroups(groupType: AdminResource | null) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.resources.list.queryOptions({ key: groupType?.key ?? '', perPage: 100 }),
    enabled: !!groupType,
  });
}

/** One group's tree. */
export function useTree(key: string, group: string | null, enabled = true) {
  const trpc = useTRPC();
  return useQuery({ ...trpc.resources.tree.queryOptions({ key, group }), enabled });
}

type MutationError = { message: string };

/**
 * Changing a tree: moves (shown at once, saved with one `PATCH tree`, and undone when the store
 * refuses), the visibility switch, inline add and delete. Moves on one tree run one after another.
 */
export function useTreeActions(type: AdminResource, group: string | null) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const qc = useQueryClient();
  const queryKey = trpc.resources.tree.queryKey({ key: type.key, group });
  const view = treeView(type);
  const current = () => qc.getQueryData<AdminTree>(queryKey);
  const refresh = () => qc.invalidateQueries({ queryKey });

  const move = useMutation({
    scope: { id: `tree:${type.key}:${group ?? ''}` },
    mutationFn: async ({
      before,
      after,
    }: {
      id: string;
      before: AdminTreeNode[];
      after: AdminTreeNode[];
    }) => {
      const nodes = treeMoves(before, after);
      if (!nodes.length) return null;
      return client.resources.moveTree.mutate({ key: type.key, group, nodes });
    },
    onMutate: async ({ after }) => {
      await qc.cancelQueries({ queryKey });
      const previous = current();
      if (previous) qc.setQueryData<AdminTree>(queryKey, { ...previous, nodes: after });
      return { previous };
    },
    onError: (e: MutationError, { id }, context) => {
      if (context?.previous) qc.setQueryData(queryKey, context.previous);
      const title = context?.previous ? findNode(context.previous.nodes, id)?.title : null;
      Alert.alert(`Couldn't move ${title ? `“${title}”` : 'it'}`, `${e.message} The move was undone.`);
    },
    onSuccess: (tree) => {
      if (tree) qc.setQueryData(queryKey, tree);
    },
  });

  /** Moves a node and everything under it; false when the move can't be made. */
  const moveTo = (id: string, at: Placement): boolean => {
    const before = current()?.nodes;
    if (!before) return false;
    const after = moveNode(before, id, at);
    if (!after) return false;
    move.mutate({ id, before, after });
    return true;
  };

  const visibility = visibilityField(type);
  const toggle = useMutation({
    mutationFn: ({ node, on }: { node: AdminTreeNode; on: boolean }) =>
      client.resources.update.mutate({
        key: type.key,
        id: node.id,
        values: { [visibility?.name ?? '']: on },
        ...(node.version !== null ? { version: node.version } : {}),
      }),
    onMutate: async ({ node, on }) => {
      await qc.cancelQueries({ queryKey });
      const previous = current();
      const name = visibility?.name;
      if (previous && name)
        qc.setQueryData<AdminTree>(queryKey, {
          ...previous,
          nodes: updateNode(previous.nodes, node.id, (n) => ({ ...n, values: { ...n.values, [name]: on } })),
        });
      return { previous };
    },
    onError: (e: MutationError, { node }, context) => {
      if (context?.previous) qc.setQueryData(queryKey, context.previous);
      Alert.alert(`Couldn't change “${node.title}”`, e.message);
    },
    onSuccess: (record: AdminRecord) => {
      const tree = current();
      // The new version and values, keeping the node's children.
      if (tree)
        qc.setQueryData<AdminTree>(queryKey, {
          ...tree,
          nodes: updateNode(tree.nodes, record.id, (n) => ({ ...n, ...record, children: n.children })),
        });
    },
  });

  /**
   * Inline add: creates a record with this title in the group (and under the parent, when the
   * parent column is a field the store takes), then moves it into place. Resolves to the store's
   * error when it needs more than a title, so the screen can open the full form instead.
   */
  const add = async (title: string, at: Placement): Promise<{ ok: true } | { ok: false; error: unknown }> => {
    const values: Record<string, unknown> = { [type.titleField]: title };
    const fieldNames = new Set(type.fields.filter((f) => !f.readonly).map((f) => f.name));
    if (view?.group && group !== null) values[view.group] = group;
    if (view && fieldNames.has(view.parent)) values[view.parent] = at.parentId;
    let created: AdminRecord;
    try {
      created = await client.resources.create.mutate({ key: type.key, values });
    } catch (error) {
      return { ok: false, error };
    }
    const before = current()?.nodes;
    // Fetch the store's tree to see where it put the new node, then move it where it was added.
    const fresh = await qc.fetchQuery({
      ...trpc.resources.tree.queryOptions({ key: type.key, group }),
      staleTime: 0,
    });
    const placed = fresh.nodes.length ? fresh.nodes : (before ?? []);
    const node = findNode(placed, created.id);
    const target = node
      ? moveNode(placed, created.id, at)
      : insertNode(before ?? [], { ...created, children: [] }, at);
    if (target && node) move.mutate({ id: created.id, before: placed, after: target });
    return { ok: true };
  };

  const remove = useMutation({
    mutationFn: (node: AdminTreeNode) => client.resources.remove.mutate({ key: type.key, id: node.id }),
    onSuccess: () => void refresh(),
    onError: (e: MutationError, node) => Alert.alert(`Couldn't delete “${node.title}”`, e.message),
  });

  return { moveTo, moving: move.isPending, visibility, toggle, add, remove, refresh };
}

type Ref = { id: string; title: string };

/**
 * Values for the full form when inline add needs more than a title: the title, the group and the
 * parent (as references, so the form shows their names).
 */
export function addPrefill(
  type: AdminResource,
  title: string,
  group: Ref | null,
  parent: Ref | null,
): Record<string, unknown> {
  const view = treeView(type);
  const prefill: Record<string, unknown> = { [type.titleField]: title };
  if (view?.group && group) prefill[view.group] = group;
  if (view && parent && type.fields.some((f) => f.name === view.parent)) prefill[view.parent] = parent;
  return prefill;
}
