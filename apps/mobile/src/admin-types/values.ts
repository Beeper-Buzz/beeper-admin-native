import {
  type AdminField,
  type AdminRecord,
  type AdminReference,
  type AdminResource,
  adminReference,
  isWritableField,
} from '@instincts/spree-domain';

/**
 * Form state for host-described admin types. Each field's editor holds a draft (text as typed,
 * a boolean, the chosen option's key or a reference); `payload` turns it into what the store
 * takes, and only changed fields are sent on save.
 */
export type Draft = string | boolean | AdminReference | null;
export type Drafts = Record<string, Draft>;

/** Which editor a field gets. Types the app doesn't know, and read-only ones, are shown as text. */
export type EditorKind =
  | 'text'
  | 'multiline'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'url'
  | 'email'
  | 'color'
  | 'json'
  | 'reference'
  | 'image'
  | 'readonly';

export function editorKind(field: AdminField): EditorKind {
  switch (field.type) {
    case 'string':
      return 'text';
    case 'text':
      return 'multiline';
    case 'integer':
    case 'decimal':
    case 'boolean':
    case 'date':
    case 'datetime':
    case 'enum':
    case 'url':
    case 'email':
    case 'color':
    case 'json':
    case 'reference':
    case 'image':
      return field.type;
    default:
      return 'readonly';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A local date as YYYY-MM-DD. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** An ISO timestamp as local `YYYY-MM-DD HH:MM`, the datetime editor's text. */
export function localDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function validDay(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Local `YYYY-MM-DD[ HH:MM]` → ISO (UTC), or null when it isn't one. */
export function isoFromLocal(text: string): string | null {
  const m = DATETIME.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map((x) => Number(x ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (!validDay(y, mo, d) || h > 23 || mi > 59) return null;
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

/** The option key an enum draft holds (options can be strings, numbers or booleans). */
const optionKey = (value: unknown) => (value === null || value === undefined ? null : String(value));

export function initialDraft(field: AdminField, value: unknown): Draft {
  switch (editorKind(field)) {
    case 'boolean':
      return value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
    case 'enum':
      return optionKey(value);
    case 'reference':
      return adminReference(value);
    case 'json':
      return value === null || value === undefined ? '' : JSON.stringify(value, null, 2);
    case 'date':
      return typeof value === 'string' ? value.slice(0, 10) : '';
    case 'datetime':
      return typeof value === 'string' ? localDateTime(value) : '';
    default:
      return value === null || value === undefined ? '' : typeof value === 'object' ? '' : String(value);
  }
}

export function draftsFor(fields: AdminField[], values: Record<string, unknown>): Drafts {
  return Object.fromEntries(fields.map((f) => [f.name, initialDraft(f, values[f.name])]));
}

const isEmpty = (draft: Draft) => draft === null || (typeof draft === 'string' && draft.trim() === '');

/** What the store takes for a draft. Call only on a draft that passed `validateDraft`. */
export function payload(field: AdminField, draft: Draft): unknown {
  const kind = editorKind(field);
  if (kind === 'boolean') return typeof draft === 'boolean' ? draft : null;
  if (kind === 'reference') return draft && typeof draft === 'object' ? draft.id : null;
  if (kind === 'enum') {
    if (typeof draft !== 'string') return null;
    return field.options?.find((o) => String(o.value) === draft)?.value ?? draft;
  }
  const text = typeof draft === 'string' ? draft : '';
  // Strings and text keep what was typed (spaces included); everything else empty is "no value".
  if (kind === 'text' || kind === 'multiline') return text;
  if (!text.trim()) return null;
  switch (kind) {
    case 'integer':
      return Number.parseInt(text.trim(), 10);
    case 'decimal':
      return text.trim().replace(',', '.');
    case 'datetime':
      return isoFromLocal(text);
    case 'json':
      // The store parses JSON text itself, which keeps empty arrays and nulls intact.
      return text;
    default:
      return text.trim();
  }
}

/** A message when the draft can't be sent as it is; the store validates the rest. */
export function validateDraft(field: AdminField, draft: Draft): string | null {
  const kind = editorKind(field);
  if (field.required && kind !== 'boolean' && isEmpty(draft)) return 'Required.';
  if (typeof draft !== 'string' || !draft.trim()) return null;
  const text = draft.trim();
  switch (kind) {
    case 'integer':
      return /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? null : 'Enter a whole number.';
    case 'decimal':
      return /^-?\d+([.,]\d+)?$/.test(text) ? null : 'Enter a number like 12.50.';
    case 'date': {
      const m = DATE.exec(text);
      return m && validDay(Number(m[1]), Number(m[2]), Number(m[3])) ? null : 'Use YYYY-MM-DD.';
    }
    case 'datetime':
      return isoFromLocal(text) ? null : 'Use YYYY-MM-DD HH:MM.';
    case 'json':
      try {
        JSON.parse(text);
        return null;
      } catch {
        return 'This isn’t valid JSON.';
      }
    case 'email':
      return /^[^\s@]+@[^\s@]+$/.test(text) ? null : 'Enter an email address.';
    case 'color':
      return text.startsWith('#') && !isHexColor(text) ? 'Use a hex colour like #1A2B3C.' : null;
    default:
      return null;
  }
}

/** Fields the form can write: declared writable, and allowed for this mode. */
export function writableFields(type: AdminResource, mode: 'create' | 'update'): AdminField[] {
  if (mode === 'create' ? !type.create : !type.update) return [];
  return type.fields.filter((f) => isWritableField(f) && editorKind(f) !== 'readonly');
}

export function validateAll(fields: AdminField[], drafts: Drafts): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const e = validateDraft(f, drafts[f.name] ?? null);
    if (e) errors[f.name] = e;
  }
  return errors;
}

/** JSON is compared by meaning, so re-indenting it isn't a change. */
function canonical(field: AdminField, draft: Draft): string {
  const value = payload(field, draft);
  if (editorKind(field) === 'json' && typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return JSON.stringify(value ?? null);
}

/** Only the fields whose value changed, for an update. */
export function changedValues(fields: AdminField[], before: Drafts, after: Drafts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const next = after[f.name] ?? null;
    if (canonical(f, before[f.name] ?? null) !== canonical(f, next)) out[f.name] = payload(f, next);
  }
  return out;
}

/**
 * Values for a new record: what was filled in. An untouched switch is left to the store's
 * default, except a required one, which is sent as off.
 */
export function createValues(fields: AdminField[], drafts: Drafts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const draft = drafts[f.name] ?? null;
    if (editorKind(f) === 'boolean') {
      if (typeof draft === 'boolean') out[f.name] = draft;
      else if (f.required) out[f.name] = false;
    } else if (!isEmpty(draft)) out[f.name] = payload(f, draft);
  }
  return out;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const humanize = (name: string) => capitalize(name.replace(/_id$/, '').replace(/_/g, ' '));

/**
 * The store's 422 `fields` as one message per form field. Rails names association errors after
 * the association (`country`), so those land on the `country_id` field; the rest are general.
 */
export function serverFieldErrors(
  fields: AdminField[],
  errors: Record<string, string[]> | null | undefined,
): { byField: Record<string, string>; general: string[] } {
  const byField: Record<string, string> = {};
  const general: string[] = [];
  const names = new Set(fields.map((f) => f.name));
  for (const [key, messages] of Object.entries(errors ?? {})) {
    const text = messages.filter(Boolean).map(capitalize).join(' ');
    if (!text) continue;
    const name = names.has(key) ? key : names.has(`${key}_id`) ? `${key}_id` : null;
    if (name) byField[name] = byField[name] ? `${byField[name]} ${text}` : text;
    else general.push(key === 'base' ? text : `${humanize(key)} ${messages.join(', ')}`);
  }
  return { byField, general };
}

/** A value as text for lists and read-only fields, dates in the device's time zone. */
export function displayValue(field: AdminField | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const kind = field ? editorKind(field) : 'readonly';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (kind === 'enum') {
    const option = field?.options?.find((o) => String(o.value) === String(value));
    return option?.label ?? humanize(String(value));
  }
  if (kind === 'reference') return adminReference(value)?.title ?? '—';
  if (kind === 'date' && typeof value === 'string') {
    const m = DATE.exec(value.slice(0, 10));
    if (m)
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
  }
  if (kind === 'datetime' && typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime()))
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
  }
  if (typeof value === 'object') {
    const ref = adminReference(value);
    if (ref && kind !== 'json') return ref.title;
    return JSON.stringify(value);
  }
  return String(value);
}

/** The list row's third line: list fields other than the title and subtitle, labelled. */
export function listDetail(type: AdminResource, record: AdminRecord): string | null {
  const parts: string[] = [];
  for (const name of type.listFields) {
    if (name === type.titleField || name === type.subtitleField) continue;
    const field = type.fields.find((f) => f.name === name);
    const value = record.values[name];
    if (value === null || value === undefined || value === '' || field?.type === 'image') continue;
    parts.push(`${field?.label ?? humanize(name)}: ${displayValue(field, value)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** "Refund reasons" → "Refund reason", for "New …" titles. */
export function singular(label: string): string {
  if (/ies$/i.test(label)) return label.replace(/ies$/i, 'y');
  if (/(s|x|ch|sh)es$/i.test(label)) return label.replace(/es$/i, '');
  if (/[^s]s$/i.test(label)) return label.slice(0, -1);
  return label;
}
