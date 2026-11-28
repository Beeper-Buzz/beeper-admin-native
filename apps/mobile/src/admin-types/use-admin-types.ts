import type { AdminResource } from '@instincts/spree-domain';
import { useQuery } from '@tanstack/react-query';
import { useCan } from '@/session/session';
import { useTRPC } from '@/trpc/trpc';
import { treeGroupKeys } from './tree/tree-type';

/**
 * The store's admin types (`admin.resources`). Fetched only when the store announces the
 * capability; the manifest changes with host deploys, not by the minute. `types` includes hidden
 * ones (gem 0.5), which are reference targets but not listed on More.
 */
export function useAdminTypes() {
  const trpc = useTRPC();
  const can = useCan();
  const enabled = can('admin.resources');
  const query = useQuery({ ...trpc.resources.manifest.queryOptions(), enabled, staleTime: 5 * 60_000 });
  return { enabled, ...query, types: query.data?.types };
}

/** One type by key, from the manifest. */
export function useAdminType(key: string | undefined) {
  const query = useAdminTypes();
  return { ...query, type: query.types?.find((t) => t.key === key) };
}

/**
 * Types by More-screen section, in the order the host registered them. Hidden types are left out,
 * and so are the group types of tree views (menu locations), which the tree screen manages: a menu
 * is one row.
 */
export function groupTypes(types: readonly AdminResource[]): { group: string; types: AdminResource[] }[] {
  const groups = new Map<string, AdminResource[]>();
  const managed = treeGroupKeys(types);
  for (const t of types) {
    if (t.hidden || managed.has(t.key)) continue;
    const list = groups.get(t.group) ?? [];
    list.push(t);
    groups.set(t.group, list);
  }
  return [...groups].map(([group, list]) => ({ group, types: list }));
}
