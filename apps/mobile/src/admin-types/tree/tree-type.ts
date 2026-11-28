import type { AdminField, AdminResource, AdminTreeView } from '@instincts/spree-domain';

/** What the manifest says about a tree-view type (gem 0.7): its view, group and visibility field. */

/** The view of a type that opens the tree screen, or null for the flat list. */
export function treeView(type: Pick<AdminResource, 'view'> | null | undefined): AdminTreeView | null {
  return type?.view?.type === 'tree' ? type.view : null;
}

/**
 * The boolean field a row's visibility switch writes: one the host marks with a hint about
 * visibility, else one named `is_visible` or `visible`. null when the type has none the app can write.
 */
export function visibilityField(type: AdminResource): AdminField | null {
  const writable = type.update
    ? type.fields.filter((f) => f.type === 'boolean' && !f.readonly)
    : ([] as AdminField[]);
  return (
    writable.find((f) => /visib/i.test(f.hint ?? '')) ??
    writable.find((f) => f.name === 'is_visible') ??
    writable.find((f) => f.name === 'visible') ??
    null
  );
}

/** The group field of a tree view and the type its values come from (menu locations), when known. */
export function treeGroup(
  type: AdminResource,
  types: readonly AdminResource[],
): { field: AdminField | null; groupType: AdminResource | null } {
  const view = treeView(type);
  const field = view?.group ? (type.fields.find((f) => f.name === view.group) ?? null) : null;
  const groupType = field?.resource ? (types.find((t) => t.key === field.resource) ?? null) : null;
  return { field, groupType };
}

/**
 * Types to leave off the More screen besides hidden ones: the group types of tree views (menu
 * locations), which the tree screen manages, so a menu shows as one row even when the host didn't
 * hide its locations.
 */
export function treeGroupKeys(types: readonly AdminResource[]): Set<string> {
  const keys = new Set<string>();
  for (const t of types) {
    const { field } = treeGroup(t, types);
    if (field?.resource && field.resource !== t.key) keys.add(field.resource);
  }
  return keys;
}
