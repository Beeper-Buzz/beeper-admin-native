import type { AdminTreeNode } from '@instincts/spree-domain';
import {
  availableSteps,
  flatten,
  insertIndex,
  moveNode,
  parentChoices,
  projectDrop,
  stepPlacement,
  treeMoves,
} from '@/admin-types/tree/tree-ops';
import { addingRow } from '@/admin-types/tree/tree-screen';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, Stack: { Screen: () => null } }));

const n = (id: string, children: AdminTreeNode[] = []): AdminTreeNode => ({
  id,
  title: id.toUpperCase(),
  subtitle: null,
  values: {},
  actions: [],
  can: { update: true, destroy: true },
  version: null,
  children,
});
/**
 * a
 *   b
 *   c
 *     d
 * e
 */
const tree = () => [n('a', [n('b'), n('c', [n('d')])]), n('e')];
const shape = (nodes: AdminTreeNode[]): string =>
  nodes.map((x) => (x.children.length ? `${x.id}(${shape(x.children)})` : x.id)).join(' ');

describe('tree operations', () => {
  it('flattens parents before children with depth and sibling index', () => {
    expect(flatten(tree()).map((f) => [f.id, f.parentId, f.depth, f.index, f.siblings])).toEqual([
      ['a', null, 0, 0, 2],
      ['b', 'a', 1, 0, 2],
      ['c', 'a', 1, 1, 2],
      ['d', 'c', 2, 0, 1],
      ['e', null, 0, 1, 2],
    ]);
  });

  it('moves a node with its subtree and never under itself', () => {
    const before = tree();
    expect(shape(moveNode(before, 'c', { parentId: null, position: 0 }) ?? [])).toBe('c(d) a(b) e');
    expect(shape(moveNode(before, 'e', { parentId: 'd', position: 0 }) ?? [])).toBe('a(b c(d(e)))');
    expect(moveNode(before, 'a', { parentId: 'd', position: 0 })).toBeNull();
    expect(moveNode(before, 'zz', { parentId: null, position: 0 })).toBeNull();
    // The original is untouched, so a refused move can be put back.
    expect(shape(before)).toBe('a(b c(d)) e');
  });

  it('steps up, down, in and out', () => {
    const t = tree();
    expect(stepPlacement(t, 'c', 'moveUp')).toEqual({ parentId: 'a', position: 0 });
    expect(stepPlacement(t, 'b', 'moveUp')).toBeNull();
    expect(stepPlacement(t, 'b', 'moveDown')).toEqual({ parentId: 'a', position: 1 });
    expect(stepPlacement(t, 'c', 'indent')).toEqual({ parentId: 'b', position: 0 });
    expect(stepPlacement(t, 'd', 'outdent')).toEqual({ parentId: 'a', position: 2 });
    expect(availableSteps(t, 'a')).toEqual(['moveDown']);
    expect(availableSteps(t, 'd')).toEqual(['outdent']);
  });

  it('sends every child of the parents whose children changed, numbered from 0', () => {
    const before = tree();
    const after = moveNode(before, 'd', { parentId: null, position: 1 }) ?? [];
    expect(treeMoves(before, after)).toEqual([
      { id: 'a', parentId: null, position: 0 },
      { id: 'd', parentId: null, position: 1 },
      { id: 'e', parentId: null, position: 2 },
    ]);
    expect(treeMoves(before, tree())).toEqual([]);
  });

  it('projects a drop from the gap and the sideways drag', () => {
    const t = tree();
    // Lifting e out leaves a b c d; dropping it at the top level after d (index 4).
    expect(projectDrop(t, 'e', 4, 0)).toBeNull();
    // Dragged right one level there: a's last child; two levels: under c, after d.
    expect(projectDrop(t, 'e', 4, 1)).toEqual({ parentId: 'a', position: 2 });
    expect(projectDrop(t, 'e', 4, 2)).toEqual({ parentId: 'c', position: 1 });
    // Dragged far right, held to one deeper than the row above (d).
    expect(projectDrop(t, 'e', 4, 9)).toEqual({ parentId: 'd', position: 0 });
    // b dropped below c's subtree, at c's level: second child of a.
    expect(projectDrop(t, 'b', 3, 0)).toEqual({ parentId: 'a', position: 1 });
    // Dropped above a: the top, whatever the sideways drag.
    expect(projectDrop(t, 'd', 0, 3)).toEqual({ parentId: null, position: 0 });
  });

  it('finds the gap from row layouts and the finger', () => {
    const t = tree();
    const layouts = new Map(['a', 'b', 'c', 'd', 'e'].map((id, i) => [id, { y: i * 50, height: 50 }]));
    // e (middle at 225) dragged up 120 points: middle at 105, past the middles of a and b.
    expect(insertIndex(t, 'e', layouts, -120)).toBe(2);
    expect(insertIndex(t, 'e', layouts, 0)).toBe(4);
    // c's subtree (d) is lifted with it and doesn't count.
    expect(insertIndex(t, 'c', layouts, 200)).toBe(3);
  });

  it('offers every parent outside the node’s own subtree', () => {
    expect(parentChoices(tree(), 'c').map((c) => [c.id, c.depth])).toEqual([
      [null, 0],
      ['a', 1],
      ['b', 2],
      ['e', 1],
    ]);
  });

  it('places an inline add above the row it goes before', () => {
    const t = tree();
    expect(addingRow(t, { parentId: 'a', position: 1 })).toEqual({
      at: { parentId: 'a', position: 1 },
      beforeId: 'c',
      depth: 1,
    });
    expect(addingRow(t, { parentId: 'a', position: 2 }).beforeId).toBe('e');
    expect(addingRow(t, { parentId: null, position: 2 }).beforeId).toBeNull();
  });
});
