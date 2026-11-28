import type { AdminTreeMove, AdminTreeNode } from '@instincts/spree-domain';

/**
 * Pure operations on a tree view's nodes (gem 0.7, `GET resources/:key/tree`). Every move returns
 * a new array and leaves the old one untouched, so the screen can show a move straight away and put
 * the old tree back when the store refuses it.
 */

/** A node in display order, with where it sits. */
export interface FlatNode {
  id: string;
  node: AdminTreeNode;
  parentId: string | null;
  depth: number;
  /** Its index among its siblings. */
  index: number;
  /** How many siblings it has, itself included. */
  siblings: number;
}

/** Every node, parents before their children, in position order. */
export function flatten(
  nodes: readonly AdminTreeNode[],
  parentId: string | null = null,
  depth = 0,
): FlatNode[] {
  const out: FlatNode[] = [];
  nodes.forEach((node, index) => {
    out.push({ id: node.id, node, parentId, depth, index, siblings: nodes.length });
    out.push(...flatten(node.children, node.id, depth + 1));
  });
  return out;
}

export function countNodes(nodes: readonly AdminTreeNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}

/** A node's id and the ids of everything under it. */
export function subtreeIds(node: AdminTreeNode): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children) for (const id of subtreeIds(child)) ids.add(id);
  return ids;
}

export function findNode(nodes: readonly AdminTreeNode[], id: string): AdminTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Where a node goes: under `parentId` (null for the top level) at `position` among the others there. */
export interface Placement {
  parentId: string | null;
  position: number;
}

function without(nodes: readonly AdminTreeNode[], id: string): [AdminTreeNode[], AdminTreeNode | null] {
  let removed: AdminTreeNode | null = null;
  const out: AdminTreeNode[] = [];
  for (const node of nodes) {
    if (node.id === id) {
      removed = node;
      continue;
    }
    const [children, inner] = without(node.children, id);
    if (inner) removed = inner;
    out.push(inner ? { ...node, children } : node);
  }
  return [out, removed];
}

function insert(nodes: readonly AdminTreeNode[], node: AdminTreeNode, at: Placement): AdminTreeNode[] | null {
  if (at.parentId === null) {
    const copy = [...nodes];
    copy.splice(Math.max(0, Math.min(at.position, copy.length)), 0, node);
    return copy;
  }
  let placed = false;
  const out = nodes.map((n) => {
    if (placed) return n;
    if (n.id === at.parentId) {
      placed = true;
      const children = [...n.children];
      children.splice(Math.max(0, Math.min(at.position, children.length)), 0, node);
      return { ...n, children };
    }
    const inner = insert(n.children, node, at);
    if (!inner) return n;
    placed = true;
    return { ...n, children: inner };
  });
  return placed ? out : null;
}

/**
 * The tree with `id` (and everything under it) moved to `at`, where `position` counts the new
 * siblings without the node itself. null when the move is impossible: an unknown node or parent,
 * or a node moved under itself.
 */
export function moveNode(nodes: readonly AdminTreeNode[], id: string, at: Placement): AdminTreeNode[] | null {
  const node = findNode(nodes, id);
  if (!node) return null;
  if (at.parentId !== null && subtreeIds(node).has(at.parentId)) return null;
  const [rest] = without(nodes, id);
  return insert(rest, node, at);
}

/** A new node (inline add) placed at `at`; null when the parent isn't in the tree. */
export function insertNode(
  nodes: readonly AdminTreeNode[],
  node: AdminTreeNode,
  at: Placement,
): AdminTreeNode[] | null {
  return insert(nodes, node, at);
}

/** The node's own placement now. */
export function placementOf(nodes: readonly AdminTreeNode[], id: string): Placement | null {
  const flat = flatten(nodes).find((f) => f.id === id);
  return flat ? { parentId: flat.parentId, position: flat.index } : null;
}

export type StepMove = 'moveUp' | 'moveDown' | 'indent' | 'outdent';

/**
 * Where one step takes a node, or null when it can't go that way: up or down among its siblings,
 * indent under the sibling above (as its last child), or outdent to just after its parent.
 */
export function stepPlacement(nodes: readonly AdminTreeNode[], id: string, step: StepMove): Placement | null {
  const flat = flatten(nodes);
  const me = flat.find((f) => f.id === id);
  if (!me) return null;
  const siblings = me.parentId === null ? nodes : (findNode(nodes, me.parentId)?.children ?? []);
  switch (step) {
    case 'moveUp':
      return me.index > 0 ? { parentId: me.parentId, position: me.index - 1 } : null;
    case 'moveDown':
      return me.index < me.siblings - 1 ? { parentId: me.parentId, position: me.index + 1 } : null;
    case 'indent': {
      const above = siblings[me.index - 1];
      return above ? { parentId: above.id, position: above.children.length } : null;
    }
    case 'outdent': {
      if (me.parentId === null) return null;
      const parent = flat.find((f) => f.id === me.parentId);
      return parent ? { parentId: parent.parentId, position: parent.index + 1 } : null;
    }
  }
}

/** Which steps a node can take now, for its menu and its accessibility actions. */
export function availableSteps(nodes: readonly AdminTreeNode[], id: string): StepMove[] {
  return (['moveUp', 'moveDown', 'indent', 'outdent'] as const).filter((s) => stepPlacement(nodes, id, s));
}

const childLists = (nodes: readonly AdminTreeNode[]) => {
  const lists = new Map<string | null, string[]>();
  for (const f of flatten(nodes)) {
    const list = lists.get(f.parentId) ?? [];
    list.push(f.id);
    lists.set(f.parentId, list);
  }
  return lists;
};

/**
 * What `PATCH resources/:key/tree` needs to turn `before` into `after`: every child, with its new
 * position counting from 0, of each parent whose list of children changed (the one a node left and
 * the one it joined). Empty when nothing moved.
 */
export function treeMoves(
  before: readonly AdminTreeNode[],
  after: readonly AdminTreeNode[],
): AdminTreeMove[] {
  const was = childLists(before);
  const now = childLists(after);
  const moves: AdminTreeMove[] = [];
  for (const parentId of new Set([...was.keys(), ...now.keys()])) {
    const ids = now.get(parentId) ?? [];
    if ((was.get(parentId) ?? []).join() === ids.join()) continue;
    ids.forEach((id, position) => {
      moves.push({ id, parentId, position });
    });
  }
  return moves;
}

/**
 * Where a dragged row lands. `insertAt` is the index, among the rows left once the dragged node
 * and everything under it are lifted out, that it is dropped in front of; `depthDelta` is how many
 * levels it was dragged right (positive) or left. The depth is held to what the neighbours allow:
 * at most one deeper than the row above, and no shallower than the row below. null when it lands
 * where it was.
 */
export function projectDrop(
  nodes: readonly AdminTreeNode[],
  id: string,
  insertAt: number,
  depthDelta: number,
): Placement | null {
  const flat = flatten(nodes);
  const me = flat.find((f) => f.id === id);
  if (!me) return null;
  const lifted = subtreeIds(me.node);
  const rest = flat.filter((f) => !lifted.has(f.id));
  const at = Math.max(0, Math.min(insertAt, rest.length));
  const above = rest[at - 1];
  const below = rest[at];
  const maxDepth = above ? above.depth + 1 : 0;
  const minDepth = below ? below.depth : 0;
  const depth = Math.max(minDepth, Math.min(maxDepth, me.depth + depthDelta));

  let parentIndex = -1;
  if (depth > 0) {
    for (let i = at - 1; i >= 0; i--) {
      if ((rest[i] as FlatNode).depth === depth - 1) {
        parentIndex = i;
        break;
      }
    }
  }
  const parentId = parentIndex >= 0 ? (rest[parentIndex] as FlatNode).id : null;
  let position = 0;
  for (let i = parentIndex + 1; i < at; i++) if ((rest[i] as FlatNode).parentId === parentId) position++;

  return parentId === me.parentId && position === me.index ? null : { parentId, position };
}

/** Rows' vertical extents (from layout), by node id. */
export type RowLayouts = ReadonlyMap<string, { y: number; height: number }>;

/**
 * The `insertAt` for `projectDrop` while dragging `id` by `dy` points: how many of the rows left
 * once it is lifted out have their middle above the dragged row's middle.
 */
export function insertIndex(
  nodes: readonly AdminTreeNode[],
  id: string,
  layouts: RowLayouts,
  dy: number,
): number {
  const flat = flatten(nodes);
  const me = flat.find((f) => f.id === id);
  const box = layouts.get(id);
  if (!me || !box) return 0;
  const lifted = subtreeIds(me.node);
  const middle = box.y + box.height / 2 + dy;
  let count = 0;
  for (const f of flat) {
    if (lifted.has(f.id)) continue;
    const row = layouts.get(f.id);
    if (row && row.y + row.height / 2 < middle) count++;
  }
  return count;
}

/** Where a node can be moved to, for the Move sheet: the top level, or under any node not in its own subtree. */
export function parentChoices(
  nodes: readonly AdminTreeNode[],
  id: string,
): { id: string | null; title: string; depth: number; childCount: number }[] {
  const node = findNode(nodes, id);
  const excluded = node ? subtreeIds(node) : new Set<string>();
  const top = nodes.filter((n) => n.id !== id).length;
  return [
    { id: null, title: 'Top level', depth: 0, childCount: top },
    ...flatten(nodes)
      .filter((f) => !excluded.has(f.id))
      .map((f) => ({
        id: f.id,
        title: f.node.title,
        depth: f.depth + 1,
        childCount: f.node.children.filter((c) => c.id !== id).length,
      })),
  ];
}

/** The tree with one node's values replaced (a visibility toggle), or unchanged when it isn't there. */
export function updateNode(
  nodes: readonly AdminTreeNode[],
  id: string,
  change: (node: AdminTreeNode) => AdminTreeNode,
): AdminTreeNode[] {
  return nodes.map((n) =>
    n.id === id ? change(n) : n.children.length ? { ...n, children: updateNode(n.children, id, change) } : n,
  );
}
