import type { AdminRecord, AdminReference } from './admin-resource';

/**
 * Gem 0.7 tree views (docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §1): records of a
 * type nest by a self-referencing `parent` column and are ordered by `position` among siblings,
 * one tree per value of an optional `group` reference field (one menu per location).
 */
export interface AdminTreeView {
  type: 'tree';
  /** The self-referencing column (`parent_id`). */
  parent: string;
  /** The integer column ordering siblings, ascending (`position`). */
  position: string;
  /** A `reference` field whose values each hold their own tree, or null for one tree. */
  group: string | null;
}

/**
 * A type's `view` as the app can use it. Only `tree` is known; anything else, or a tree missing its
 * columns, is null and the app keeps the flat list.
 */
export function normalizeView(raw: unknown): AdminTreeView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (v.type !== 'tree') return null;
  if (typeof v.parent !== 'string' || !v.parent || typeof v.position !== 'string' || !v.position) return null;
  return {
    type: 'tree',
    parent: v.parent,
    position: v.position,
    group: typeof v.group === 'string' && v.group ? v.group : null,
  };
}

/** A record in a tree, with its children in position order. */
export interface AdminTreeNode extends AdminRecord {
  children: AdminTreeNode[];
}

/** One group's tree (`GET resources/:key/tree`). */
export interface AdminTree {
  nodes: AdminTreeNode[];
  /** The group it belongs to; null for a type without groups, or the whole table. */
  group: AdminReference | null;
}

/** One node's place, as `PATCH resources/:key/tree` takes it. `position` counts from 0. */
export interface AdminTreeMove {
  id: string;
  parentId: string | null;
  position: number;
}
