import {
  type AdminActionResult,
  AdminBlob,
  type AdminManifest,
  AdminRecord,
  AdminResource,
  type AdminTree,
  type AdminTreeNode,
  adminReference,
  gemAtLeast,
} from '@instincts/spree-domain';
import { isSpreeError, SpreeError } from '../errors';
import { appendFile } from '../media/shared';
import type { AdminDateRange, ListAdminRecordsParams, ResourcesPort } from '../ports';
import type { Transport } from '../transport';

/**
 * Host-described admin types through the companion gem (0.4+): `GET resources` and friends.
 * Gem 0.5 keys are read when present; without them everything maps as it did for 0.4, and the
 * requests carry nothing new.
 */
const BASE = '/api/admin_native/v1/resources';
/** The gem version from which image and file fields take uploads. */
const UPLOADS_FROM = '0.5';

export interface GemAdminField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  readonly?: boolean;
  options?: unknown;
  resource?: string | null;
  hint?: string | null;
  /** 0.5 */
  default?: unknown;
  /** 0.7, `link` fields: kind names, `{ kind, resource, label }` or a kind-to-resource map. */
  kinds?: unknown;
}

export interface GemAdminFilter {
  name: string;
  label?: string;
  options?: unknown;
  /** 0.5: `enum`, `reference`, `presence` or `date_range`; absent on 0.4. */
  type?: string;
  resource?: string | null;
}

export interface GemAdminAction {
  name: string;
  label?: string;
  confirm?: string | null;
  destructive?: boolean;
  /** 0.5: field JSON. */
  inputs?: GemAdminField[];
}

export interface GemAdminResource {
  key: string;
  label?: string;
  /** 0.5 */
  singular?: string | null;
  /** 0.5 */
  hidden?: boolean;
  group?: string;
  icon?: string | null;
  title_field?: string;
  subtitle_field?: string | null;
  list_fields?: string[];
  searchable?: boolean;
  filters?: GemAdminFilter[];
  fields?: GemAdminField[];
  create?: boolean;
  update?: boolean;
  destroy?: boolean;
  actions?: GemAdminAction[];
  /** 0.7: `{ type: 'tree', parent, position, group? }`. */
  view?: unknown;
}

/** 0.7 `GET resources/:key/tree`: a record with its children. */
export interface GemAdminTreeNode extends GemAdminRecord {
  children?: GemAdminTreeNode[];
}

export interface GemAdminTree {
  data: GemAdminTreeNode[];
  meta?: { group?: { id: string | number; title?: string | null } | null };
}

export interface GemAdminRecord {
  id: string | number;
  title?: string | null;
  subtitle?: string | null;
  values?: Record<string, unknown>;
  actions?: string[];
  /** 0.5 */
  can?: { update?: boolean; destroy?: boolean };
  /** 0.5: `lock_version`, or `updated_at` as ISO 8601. */
  version?: string | number | null;
}

export interface GemAdminBlob {
  signed_id: string;
  filename?: string | null;
  content_type?: string | null;
  byte_size?: number | null;
  url?: string | null;
}

const humanize = (name: string) => {
  const s = name.replace(/_id$/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const mapFields = (fields: GemAdminField[] | undefined, uploads: boolean) =>
  (Array.isArray(fields) ? fields : [])
    .filter((f) => f && typeof f.name === 'string' && f.name)
    .map((f) => ({
      name: f.name,
      type: f.type,
      rawType: String(f.type ?? ''),
      label: f.label || humanize(f.name),
      required: !!f.required,
      // Before 0.5 the gem never wrote image fields (and had no file fields).
      readonly: !!f.readonly || (!uploads && (f.type === 'image' || f.type === 'file')),
      options: f.options ?? null,
      resource: f.resource ?? null,
      hint: f.hint ?? null,
      default: f.default ?? null,
      kinds: f.kinds ?? null,
    }));

/**
 * null when the entry is too broken to show (no key); one bad type never hides the others.
 * `gemVersion` is the manifest's `meta.gem_version`: image and file fields are writable from 0.5.
 */
export function mapGemResource(r: GemAdminResource, gemVersion: string | null = null): AdminResource | null {
  const uploads = gemAtLeast(gemVersion, UPLOADS_FROM);
  const parsed = AdminResource.safeParse({
    key: r.key,
    label: r.label || (r.key ? humanize(r.key) : ''),
    singular: typeof r.singular === 'string' && r.singular ? r.singular : null,
    hidden: r.hidden === true,
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
      type: f.type,
      resource: f.resource ?? null,
    })),
    fields: mapFields(r.fields, uploads),
    create: !!r.create,
    update: !!r.update,
    destroy: !!r.destroy,
    actions: (r.actions ?? []).map((a) => ({
      name: a.name,
      label: a.label || humanize(a.name ?? ''),
      confirm: a.confirm || null,
      destructive: !!a.destructive,
      inputs: mapFields(a.inputs, uploads),
    })),
    view: r.view ?? null,
  });
  return parsed.success ? parsed.data : null;
}

/** A tree node and its children, in the order the store sent them (position order). */
export function mapGemTreeNode(n: GemAdminTreeNode): AdminTreeNode {
  const children = Array.isArray(n.children) ? n.children : [];
  return { ...mapGemRecord(n), children: children.map(mapGemTreeNode) };
}

export function mapGemTree(body: GemAdminTree): AdminTree {
  const g = body.meta?.group;
  return {
    nodes: (Array.isArray(body.data) ? body.data : []).map(mapGemTreeNode),
    group: g ? adminReference({ id: String(g.id), title: g.title || `#${g.id}` }) : null,
  };
}

export function mapGemRecord(r: GemAdminRecord): AdminRecord {
  const can = r.can && typeof r.can === 'object' ? r.can : {};
  return AdminRecord.parse({
    id: String(r.id),
    title: r.title || `#${r.id}`,
    subtitle: r.subtitle || null,
    values: r.values ?? {},
    actions: r.actions ?? [],
    can: { update: can.update !== false, destroy: can.destroy !== false },
    version: typeof r.version === 'string' || typeof r.version === 'number' ? r.version : null,
  });
}

export function mapGemBlob(b: GemAdminBlob): AdminBlob {
  return AdminBlob.parse({
    signedId: b.signed_id,
    filename: b.filename || 'File',
    contentType: b.content_type || null,
    byteSize: typeof b.byte_size === 'number' ? b.byte_size : null,
    url: b.url || null,
  });
}

const path = (key: string, ...rest: string[]) =>
  [BASE, key, ...rest].map((p, i) => (i ? encodeURIComponent(p) : p)).join('/');

const isRange = (v: unknown): v is AdminDateRange => typeof v === 'object' && v !== null;

/**
 * Rails params: booleans and numbers as they are, null as an empty value (no filter), a date
 * range as `filter[name][from]` / `[to]` with only the ends that are set.
 */
function filterQuery(filters: ListAdminRecordsParams['filters']) {
  const out: Record<string, string | number | boolean | { from?: string; to?: string }> = {};
  for (const [name, value] of Object.entries(filters ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    if (isRange(value)) {
      const range: { from?: string; to?: string } = {};
      if (value.from) range.from = value.from;
      if (value.to) range.to = value.to;
      if (range.from || range.to) out[name] = range;
      continue;
    }
    out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** What the gem's 409 says; used when a store sends no message of its own. */
export const CONFLICT_MESSAGE = 'Someone else changed this. Reload to see their changes.';
const MAX_UPLOAD = '25 MB';

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
    async manifest(): Promise<AdminManifest> {
      const res = await transport.request<{ data: GemAdminResource[]; meta?: { gem_version?: unknown } }>({
        path: BASE,
      });
      const v = res.data.meta?.gem_version;
      const gemVersion = typeof v === 'string' && v ? v : null;
      return {
        types: (res.data.data ?? [])
          .map((r) => mapGemResource(r, gemVersion))
          .filter((r): r is AdminResource => r !== null),
        meta: { gemVersion },
      };
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
    async update(key, id, values, version) {
      // A version only when the record had one, so a 0.4 store gets what it did before.
      const body = version === null || version === undefined ? { values } : { values, version };
      try {
        return await one(path(key, id), 'PATCH', body);
      } catch (e) {
        if (isSpreeError(e) && e.kind === 'conflict' && e.message === `Request failed (${e.status}).`)
          throw new SpreeError({
            kind: 'conflict',
            status: e.status,
            message: CONFLICT_MESSAGE,
            body: e.body,
            cause: e,
          });
        throw e;
      }
    },
    async remove(key, id) {
      await transport.request({ method: 'DELETE', path: path(key, id) });
    },
    async perform(key, id, action, input): Promise<AdminActionResult> {
      const res = await transport.request<{
        data: GemAdminRecord | null;
        message?: string | null;
        removed?: boolean;
      }>({
        method: 'POST',
        path: path(key, id, 'actions', action),
        // A body only with inputs, so a 0.4 store gets what it did before.
        ...(input && Object.keys(input).length ? { body: { input } } : {}),
      });
      const { data, message, removed } = res.data;
      const record = data ? mapGemRecord(data) : null;
      return { record, message: message || null, removed: removed === true || record === null };
    },
    async upload(file) {
      const form = new FormData();
      appendFile(form, 'file', file);
      try {
        const res = await transport.request<{ data: GemAdminBlob }>({
          method: 'POST',
          path: `${BASE}/uploads`,
          body: form,
          // Large files on a phone connection take longer than a JSON call.
          timeoutMs: 120_000,
        });
        return mapGemBlob(res.data.data);
      } catch (e) {
        if (isSpreeError(e) && e.status === 413)
          throw new SpreeError({
            kind: 'invalid',
            status: 413,
            message: `This file is too big. The store takes files up to ${MAX_UPLOAD}.`,
            body: e.body,
            cause: e,
          });
        throw e;
      }
    },
    async tree(key, group) {
      const res = await transport.request<GemAdminTree>({
        path: path(key, 'tree'),
        ...(group === null ? {} : { query: { group } }),
      });
      return mapGemTree(res.data);
    },
    async moveTree(key, group, nodes) {
      const res = await transport.request<GemAdminTree>({
        method: 'PATCH',
        path: path(key, 'tree'),
        body: {
          group,
          nodes: nodes.map((n) => ({ id: n.id, parent_id: n.parentId, position: n.position })),
        },
      });
      return mapGemTree(res.data);
    },
  };
}
