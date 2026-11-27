import { z } from 'zod';
import { Id, tolerantEnum } from './common';

/**
 * Host-described admin types (companion gem 0.4, `SpreeAdminNative.resources`): menus, homepage
 * sections, push notifications… The host registers each type and the app renders generic list,
 * detail and form screens from this manifest, so a new type needs no app release.
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
});
export type AdminField = z.infer<typeof AdminField>;

export const AdminFilter = z.object({
  name: z.string().min(1),
  label: z.string(),
  /** Empty when the host gave no choices; the app can't offer chips for those. */
  options: z.preprocess((v) => normalizeOptions(v) ?? [], z.array(AdminOption)),
});
export type AdminFilter = z.infer<typeof AdminFilter>;

/** A member action the host declared (`r.action :publish …`). */
export const AdminAction = z.object({
  name: z.string().min(1),
  label: z.string(),
  /** Ask before running, with this question. */
  confirm: z.string().nullable().default(null),
  destructive: z.boolean().default(false),
});
export type AdminAction = z.infer<typeof AdminAction>;

/** One admin type in the manifest. */
export const AdminResource = z.object({
  key: z.string().min(1),
  label: z.string(),
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
});
export type AdminRecord = z.infer<typeof AdminRecord>;

export interface AdminActionResult {
  record: AdminRecord;
  /** What the action said it did ("Sending."), if anything. */
  message: string | null;
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

/** Whether the app can send a value for this field (the store decides in the end). */
export function isWritableField(field: Pick<AdminField, 'type' | 'readonly'>): boolean {
  return !field.readonly && field.type !== 'readonly' && field.type !== 'image' && field.type !== 'unknown';
}
