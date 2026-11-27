import { z } from 'zod';
import { Id, tolerantEnum } from './common';

/**
 * Host-described admin types (companion gem 0.4+, `SpreeAdminNative.resources`): menus, homepage
 * sections, push notifications… The host registers each type and the app renders generic list,
 * detail and form screens from this manifest, so a new type needs no app release.
 *
 * Gem 0.5 adds keys (singular labels, hidden types, field defaults, per-record rules, versions,
 * action inputs, typed filters, file fields, uploads). Every one is optional here: a 0.4 manifest
 * parses to the same thing it did before, and unknown values fall back to 0.4 behaviour.
 */

/** Field types the app has an editor for. Anything else parses as `unknown` and is shown read-only. */
export const ADMIN_FIELD_TYPES = [
  'string',
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'enum',
  'url',
  'email',
  'color',
  'json',
  'reference',
  'image',
  /** Gem 0.5: an attached file, read as `{ url, filename, content_type, byte_size }`. */
  'file',
  'readonly',
] as const;
export const AdminFieldType = tolerantEnum(ADMIN_FIELD_TYPES);
export type AdminFieldType = z.infer<typeof AdminFieldType>;

const Scalar = z.union([z.string(), z.number(), z.boolean()]);
type Scalar = z.infer<typeof Scalar>;

/** A choice for an enum field or a list filter. `value` is what the store stores and filters on. */
export const AdminOption = z.object({ value: Scalar, label: z.string() });
export type AdminOption = z.infer<typeof AdminOption>;

const isScalar = (v: unknown): v is Scalar =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

function optionLabel(value: Scalar): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  const s = String(value);
  return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s;
}

/**
 * Hosts write options as plain values (`%w[draft sent]`, `[true, false]`), `{ value, label }`
 * objects or Rails-style `[label, value]` pairs; all become `{ value, label }`. Others are dropped.
 */
export function normalizeOptions(raw: unknown): AdminOption[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AdminOption[] = [];
  for (const item of raw) {
    if (isScalar(item)) out.push({ value: item, label: optionLabel(item) });
    else if (Array.isArray(item) && item.length === 2 && isScalar(item[0]) && isScalar(item[1]))
      out.push({ value: item[1], label: String(item[0]) });
    else if (typeof item === 'object' && item !== null && isScalar((item as { value?: unknown }).value)) {
      const { value, label } = item as { value: Scalar; label?: unknown };
      out.push({ value, label: typeof label === 'string' && label ? label : optionLabel(value) });
    }
  }
  return out;
}

const Options = z.preprocess((v) => normalizeOptions(v), z.array(AdminOption).nullable());

/** A field's default as JSON gives it: a scalar, a list, an object, or null for none. */
export type AdminDefault = string | number | boolean | null | unknown[] | Record<string, unknown>;

export const AdminField = z.object({
  /** Attribute name, the key in a record's `values`. */
  name: z.string().min(1),
  type: AdminFieldType,
  /** The type as the host sent it (differs from `type` when the app doesn't know it). */
  rawType: z.string(),
  label: z.string(),
  required: z.boolean().default(false),
  readonly: z.boolean().default(false),
  /** Choices for `enum` fields. */
  options: Options.default(null),
  /** Target type key for `reference` fields. */
  resource: z.string().nullable().default(null),
  hint: z.string().nullable().default(null),
  /**
   * Gem 0.5: what the create form starts with, in the store's shapes (like a record's value).
   * null when there is none.
   */
  default: z
    .unknown()
    .default(null)
    .transform(
      (v): AdminDefault => (v === undefined || typeof v === 'function' ? null : (v as AdminDefault)),
    ),
});
export type AdminField = z.infer<typeof AdminField>;

/**
 * How a list filter is chosen. `enum` (and a 0.4 filter, which has no type) offers its options as
 * chips; `reference` takes a record of `resource`; `presence` is set or not set; `date_range` takes
 * from and to dates. A type the app doesn't know is `unknown` and treated like `enum`.
 */
export const ADMIN_FILTER_TYPES = ['enum', 'reference', 'presence', 'date_range'] as const;
const FilterType = tolerantEnum(ADMIN_FILTER_TYPES);
export type AdminFilterType = z.infer<typeof FilterType>;

export const AdminFilter = z.object({
  name: z.string().min(1),
  label: z.string(),
  type: z.preprocess((v) => v ?? 'enum', FilterType),
  /** Empty when the host gave no choices; the app can't offer chips for those. */
  options: z.preprocess((v) => normalizeOptions(v) ?? [], z.array(AdminOption)),
  /** Target type key for `reference` filters. */
  resource: z.string().nullable().default(null),
});
export type AdminFilter = z.infer<typeof AdminFilter>;

/** A member action the host declared (`r.action :publish …`). */
export const AdminAction = z.object({
  name: z.string().min(1),
  label: z.string(),
  /** Ask before running, with this question. */
  confirm: z.string().nullable().default(null),
  destructive: z.boolean().default(false),
  /** Gem 0.5: what to ask for before running, sent as the action's `input`. Empty runs it straight away. */
  inputs: z.array(AdminField).default([]),
});
export type AdminAction = z.infer<typeof AdminAction>;

/** One admin type in the manifest. */
export const AdminResource = z.object({
  key: z.string().min(1),
  label: z.string(),
  /** Gem 0.5: one of them ("Menu item"); null on 0.4, where the app singularizes `label`. */
  singular: z.string().nullable().default(null),
  /** Gem 0.5: not listed on the More screen, but still listable as a reference target. */
  hidden: z.boolean().default(false),
  /** Section on the More screen. */
  group: z.string().default('More'),
  /** SF Symbol name; the app shows it only when it knows the symbol. */
  icon: z.string().nullable().default(null),
  titleField: z.string(),
  subtitleField: z.string().nullable().default(null),
  listFields: z.array(z.string()).default([]),
  searchable: z.boolean().default(false),
  filters: z.array(AdminFilter).default([]),
  fields: z.array(AdminField).default([]),
  create: z.boolean().default(false),
  update: z.boolean().default(false),
  destroy: z.boolean().default(false),
  actions: z.array(AdminAction).default([]),
});
export type AdminResource = z.infer<typeof AdminResource>;

/** The manifest's `meta`. `gemVersion` is null before gem 0.5, which didn't send one. */
export const AdminManifestMeta = z.object({ gemVersion: z.string().nullable().default(null) });
export type AdminManifestMeta = z.infer<typeof AdminManifestMeta>;

export interface AdminManifest {
  /** The available types, in the host's order, hidden ones included. */
  types: AdminResource[];
  meta: AdminManifestMeta;
}

/** Whether a gem version (`0.5.0`) is at least `min` (`0.5`); false when it is unknown. */
export function gemAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version) return false;
  const parts = (v: string) => v.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return true;
}

/** What a reference field holds: the target's id and title. */
export const AdminReference = z.object({ id: Id, title: z.string() });
export type AdminReference = z.infer<typeof AdminReference>;

export const AdminRecord = z.object({
  id: Id,
  title: z.string(),
  subtitle: z.string().nullable().default(null),
  /**
   * By field name, as the store sends them: strings, numbers, booleans, ISO dates, decimal strings,
   * JSON, `{ id, title }` for references and an image URL for images.
   */
  values: z.record(z.string(), z.unknown()).default({}),
  /** Names of the member actions available for this record now. */
  actions: z.array(z.string()).default([]),
  /**
   * Gem 0.5: whether this record can be edited and deleted (the type's switches and the host's
   * rule for it). Both true when the store doesn't say, so the type's switches decide as in 0.4.
   */
  can: z
    .object({ update: z.boolean().default(true), destroy: z.boolean().default(true) })
    .default({ update: true, destroy: true }),
  /**
   * Gem 0.5: the record's version (`lock_version`, or `updated_at`), sent back with an update so
   * the store can refuse it with a conflict when someone else saved in between. null when absent.
   */
  version: z.union([z.string(), z.number()]).nullable().default(null),
});
export type AdminRecord = z.infer<typeof AdminRecord>;

export interface AdminActionResult {
  /** The record after the action; null when the action removed it. */
  record: AdminRecord | null;
  /** What the action said it did ("Sending."), if anything. */
  message: string | null;
  /** Gem 0.5: the record is gone (deleted, or no longer in the type's list). */
  removed: boolean;
}

/** A file uploaded to the store (gem 0.5 `POST resources/uploads`), ready to attach by `signedId`. */
export const AdminBlob = z.object({
  signedId: z.string().min(1),
  filename: z.string(),
  contentType: z.string().nullable().default(null),
  byteSize: z.number().nullable().default(null),
  url: z.string().nullable().default(null),
});
export type AdminBlob = z.infer<typeof AdminBlob>;

/** What a `file` field holds: the attached file, as the store describes it. */
export const AdminFile = z.object({
  url: z.string().nullable().default(null),
  filename: z.string(),
  contentType: z.string().nullable().default(null),
  byteSize: z.number().nullable().default(null),
});
export type AdminFile = z.infer<typeof AdminFile>;

/** A `file` field's value (`{ url, filename, content_type, byte_size }`) as an AdminFile, or null. */
export function adminFile(value: unknown): AdminFile | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const url = typeof v.url === 'string' && v.url ? v.url : null;
  const filename =
    typeof v.filename === 'string' && v.filename
      ? v.filename
      : url
        ? decodeURIComponent(url.split('?')[0]?.split('/').pop() ?? '') || 'File'
        : null;
  if (!filename) return null;
  const size = v.byte_size ?? v.byteSize;
  const type = v.content_type ?? v.contentType;
  return {
    url,
    filename,
    contentType: typeof type === 'string' && type ? type : null,
    byteSize: typeof size === 'number' && Number.isFinite(size) ? size : null,
  };
}

/** "512 KB", "3.4 MB". */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || Number.isInteger(n) ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** A reference value as `{ id, title }`, from the store's object or a bare id. */
export function adminReference(value: unknown): AdminReference | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number')
    return { id: String(value), title: `#${value}` };
  const parsed = AdminReference.safeParse(
    typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number'
      ? { ...value, id: String((value as { id: number }).id) }
      : value,
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Whether the app can send a value for this field (the store decides in the end). Image and file
 * fields take an uploaded blob's `signedId` (gem 0.5); on a 0.4 store the SDK marks them read-only.
 */
export function isWritableField(field: Pick<AdminField, 'type' | 'readonly'>): boolean {
  return !field.readonly && field.type !== 'readonly' && field.type !== 'unknown';
}
