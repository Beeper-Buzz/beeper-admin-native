import { type AdminActionResult, AdminRecord, AdminResource } from '@instincts/spree-domain';
import type { ListAdminRecordsParams, ResourcesPort } from '../ports';
import type { Transport } from '../transport';

/** Host-described admin types through the companion gem (0.4+): `GET resources` and friends. */
const BASE = '/api/admin_native/v1/resources';

export interface GemAdminField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  readonly?: boolean;
  options?: unknown;
  resource?: string | null;
  hint?: string | null;
}

export interface GemAdminResource {
  key: string;
  label?: string;
  group?: string;
  icon?: string | null;
  title_field?: string;
  subtitle_field?: string | null;
  list_fields?: string[];
  searchable?: boolean;
  filters?: { name: string; label?: string; options?: unknown }[];
  fields?: GemAdminField[];
  create?: boolean;
  update?: boolean;
  destroy?: boolean;
  actions?: { name: string; label?: string; confirm?: string | null; destructive?: boolean }[];
}

export interface GemAdminRecord {
  id: string | number;
  title?: string | null;
  subtitle?: string | null;
  values?: Record<string, unknown>;
  actions?: string[];
}

const humanize = (name: string) => {
  const s = name.replace(/_id$/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** null when the entry is too broken to show (no key); one bad type never hides the others. */
export function mapGemResource(r: GemAdminResource): AdminResource | null {
  const fields = (r.fields ?? [])
    .filter((f) => f && typeof f.name === 'string' && f.name)
    .map((f) => ({
      name: f.name,
      type: f.type,
      rawType: String(f.type ?? ''),
      label: f.label || humanize(f.name),
      required: !!f.required,
      readonly: !!f.readonly,
      options: f.options ?? null,
      resource: f.resource ?? null,
      hint: f.hint ?? null,
    }));
  const parsed = AdminResource.safeParse({
    key: r.key,
    label: r.label || (r.key ? humanize(r.key) : ''),
    group: r.group || 'More',
    icon: r.icon || null,
    titleField: r.title_field || 'id',
    subtitleField: r.subtitle_field || null,
    listFields: r.list_fields ?? [],
    searchable: !!r.searchable,
    filters: (r.filters ?? []).map((f) => ({
      name: f.name,
      label: f.label || humanize(f.name ?? ''),
      options: f.options,
    })),
    fields,
    create: !!r.create,
    update: !!r.update,
    destroy: !!r.destroy,
    actions: (r.actions ?? []).map((a) => ({
      name: a.name,
      label: a.label || humanize(a.name ?? ''),
      confirm: a.confirm || null,
      destructive: !!a.destructive,
    })),
  });
  return parsed.success ? parsed.data : null;
}

export function mapGemRecord(r: GemAdminRecord): AdminRecord {
  return AdminRecord.parse({
    id: String(r.id),
    title: r.title || `#${r.id}`,
    subtitle: r.subtitle || null,
    values: r.values ?? {},
    actions: r.actions ?? [],
  });
}

const path = (key: string, ...rest: string[]) =>
  [BASE, key, ...rest].map((p, i) => (i ? encodeURIComponent(p) : p)).join('/');

/** Rails params: booleans and numbers as they are, null as an empty value (no filter). */
function filterQuery(filters: ListAdminRecordsParams['filters']) {
  const out: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(filters ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export function companionResources(transport: Transport): ResourcesPort {
  const one = async (
    p: string,
    method: 'GET' | 'POST' | 'PATCH' = 'GET',
    body?: unknown,
  ): Promise<AdminRecord> => {
    const res = await transport.request<{ data: GemAdminRecord }>({ method, path: p, body });
    return mapGemRecord(res.data.data);
  };
  return {
    async manifest() {
      const res = await transport.request<{ data: GemAdminResource[] }>({ path: BASE });
      return (res.data.data ?? []).map(mapGemResource).filter((r): r is AdminResource => r !== null);
    },
    async list(key, params) {
      const page = params.cursor ? Math.max(1, Number(params.cursor) || 1) : 1;
      const perPage = params.perPage ?? 25;
      const res = await transport.request<{
        data: GemAdminRecord[];
        meta: { page: number; per_page: number; total_count: number };
      }>({
        path: path(key),
        query: {
          q: params.query?.trim() || undefined,
          filter: filterQuery(params.filters),
          page,
          per_page: perPage,
        },
      });
      const { data, meta } = res.data;
      return {
        items: data.map(mapGemRecord),
        nextCursor: page * meta.per_page < meta.total_count ? String(page + 1) : null,
        totalCount: meta.total_count,
      };
    },
    get: (key, id) => one(path(key, id)),
    create: (key, values) => one(path(key), 'POST', { values }),
    update: (key, id, values) => one(path(key, id), 'PATCH', { values }),
    async remove(key, id) {
      await transport.request({ method: 'DELETE', path: path(key, id) });
    },
    async perform(key, id, action): Promise<AdminActionResult> {
      const res = await transport.request<{ data: GemAdminRecord; message?: string | null }>({
        method: 'POST',
        path: path(key, id, 'actions', action),
      });
      return { record: mapGemRecord(res.data.data), message: res.data.message || null };
    },
  };
}
