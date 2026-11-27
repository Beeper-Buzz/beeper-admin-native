import type { AdminResource } from '@instincts/spree-domain';
import { useQuery } from '@tanstack/react-query';
import { useCan } from '@/session/session';
import { useTRPC } from '@/trpc/trpc';

/**
 * The store's admin types (`admin.resources`). Fetched only when the store announces the
 * capability; the manifest changes with host deploys, not by the minute.
 */
export function useAdminTypes() {
  const trpc = useTRPC();
  const can = useCan();
  const enabled = can('admin.resources');
  const query = useQuery({ ...trpc.resources.manifest.queryOptions(), enabled, staleTime: 5 * 60_000 });
  return { enabled, ...query };
}

/** One type by key, from the manifest. */
export function useAdminType(key: string | undefined) {
  const query = useAdminTypes();
  return { ...query, type: query.data?.find((t) => t.key === key) };
}

/** Types by More-screen section, in the order the host registered them. */
export function groupTypes(types: readonly AdminResource[]): { group: string; types: AdminResource[] }[] {
  const groups = new Map<string, AdminResource[]>();
  for (const t of types) {
    const list = groups.get(t.group) ?? [];
    list.push(t);
    groups.set(t.group, list);
  }
  return [...groups].map(([group, list]) => ({ group, types: list }));
}
