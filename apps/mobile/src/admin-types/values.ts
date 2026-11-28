import {
  type AdminField,
  type AdminLink,
  type AdminRecord,
  type AdminReference,
  type AdminResource,
  adminFile,
  adminLink,
  adminReference,
  isWritableField,
  linkKinds,
} from '@instincts/spree-domain';

/**
 * An image or file field's draft: what is attached now (`signedId` null), or a file just uploaded
 * (`signedId` set, which is what the store takes to attach it). null means none, or removed.
 */
export interface AttachmentDraft {
  /** Shown as the image, or opened for a file; a local file URI for a fresh photo. */
  url: string | null;
  filename: string | null;
  contentType: string | null;
  byteSize: number | null;
  signedId: string | null;
}

/**
 * Form state for host-described admin types. Each field's editor holds a draft (text as typed,
 * a boolean, the chosen option's key, a reference or an attachment); `payload` turns it into what
 * the store takes, and only changed fields are sent on save.
 */
export type Draft = string | boolean | AdminReference | AttachmentDraft | AdminLink | null;

export const isAttachment = (draft: Draft | undefined): draft is AttachmentDraft =>
  typeof draft === 'object' && draft !== null && 'signedId' in draft;

/** A link field's draft (gem 0.7): the chosen kind with the URL as typed, or the chosen record. */
export const isLinkDraft = (draft: Draft | undefined): draft is AdminLink =>
  typeof draft === 'object' && draft !== null && 'kind' in draft;

/** The `prefill` route param of the new-record screen (JSON), or null when absent or unreadable. */
export function parsePrefill(param: string | null | undefined): Record<string, unknown> | null {
  if (!param) return null;
  try {
    const value: unknown = JSON.parse(param);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The name of a link kind: the host's label, the target type's singular label, else the kind. */
export function linkKindLabel(
  kind: { kind: string; resource: string | null; label: string | null },
  types: readonly AdminResource[],
): string {
  if (kind.label) return kind.label;
  if (kind.kind === 'url') return 'URL';
  const target = types.find((t) => t.key === kind.resource);
  return target ? singularLabel(target) : capitalize(kind.kind.replace(/_/g, ' '));
}

/** A link as text: the URL, or the record's title (or id) after its kind. */
export function linkText(link: AdminLink, types: readonly AdminResource[] = [], field?: AdminField): string {
  if (link.kind === 'url') return link.url ?? '—';
  const kind = (field ? linkKinds(field) : []).find((k) => k.kind === link.kind) ?? {
    kind: link.kind,
    resource: null,
    label: null,
  };
  return `${linkKindLabel(kind, types)}: ${link.title ?? `#${link.id}`}`;
}

/** A URL a menu can link to: http(s), a site path (`/sale`), `mailto:` or `tel:`. */
export function isLinkUrl(text: string): boolean {
  const t = text.trim();
  if (/^\/(?!\/)\S*$/.test(t) || /^(mailto|tel):\S+$/i.test(t)) return true;
  try {
    const u = new URL(t);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.host;
  } catch {
    return false;
  }
}
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
  | 'file'
  | 'link'
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
    case 'file':
    case 'link':
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

/** Whether text is a real day as `YYYY-MM-DD`. */
export function isDay(text: string): boolean {
  const m = DATE.exec(text.trim());
  return !!m && validDay(Number(m[1]), Number(m[2]), Number(m[3]));
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
    case 'image':
      return typeof value === 'string' && value
        ? { url: value, filename: null, contentType: null, byteSize: null, signedId: null }
        : null;
    case 'file': {
      const file = adminFile(value);
      return file ? { ...file, signedId: null } : null;
    }
    case 'link':
      return adminLink(value);
    default:
      return value === null || value === undefined ? '' : typeof value === 'object' ? '' : String(value);
  }
}

export function draftsFor(fields: AdminField[], values: Record<string, unknown>): Drafts {
  return Object.fromEntries(fields.map((f) => [f.name, initialDraft(f, values[f.name])]));
}

/** Drafts for a new record or an action's inputs: each field's `default` (gem 0.5), else empty. */
export function defaultDrafts(fields: AdminField[]): Drafts {
  return draftsFor(fields, Object.fromEntries(fields.map((f) => [f.name, f.default])));
}

const isEmpty = (draft: Draft) =>
  draft === null ||
  (typeof draft === 'string' && draft.trim() === '') ||
  (isLinkDraft(draft) && (draft.kind === 'url' ? !draft.url?.trim() : !draft.id));

/** What the store takes for a draft. Call only on a draft that passed `validateDraft`. */
export function payload(field: AdminField, draft: Draft): unknown {
  const kind = editorKind(field);
  if (kind === 'boolean') return typeof draft === 'boolean' ? draft : null;
  if (kind === 'image' || kind === 'file') {
    if (!isAttachment(draft)) return null;
    // An unchanged attachment compares by its URL and is never sent; a new one is sent by signed id.
    return draft.signedId ?? draft.url ?? draft.filename;
  }
  if (kind === 'link') {
    // `{ kind, url }` or `{ kind, id }`; an empty link clears the field.
    if (!isLinkDraft(draft) || isEmpty(draft)) return null;
    return draft.kind === 'url'
      ? { kind: 'url', url: draft.url?.trim() ?? '' }
      : { kind: draft.kind, id: draft.id };
  }
  if (kind === 'reference') return draft && typeof draft === 'object' && 'id' in draft ? draft.id : null;
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
  if (kind === 'link' && isLinkDraft(draft) && draft.kind === 'url' && draft.url?.trim())
    return isLinkUrl(draft.url) ? null : 'Enter a link like https://example.com or /sale.';
  if (typeof draft !== 'string' || !draft.trim()) return null;
  const text = draft.trim();
  switch (kind) {
    case 'integer':
      return /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? null : 'Enter a whole number.';
    case 'decimal':
      return /^-?\d+([.,]\d+)?$/.test(text) ? null : 'Enter a number like 12.50.';
    case 'date':
      return isDay(text) ? null : 'Use YYYY-MM-DD.';
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

/**
 * Fields the form can write: declared writable, and allowed for this mode and record (`canUpdate`
 * is the record's gem 0.5 `can.update`; a 0.4 record always allows it).
 */
export function writableFields(
  type: AdminResource,
  mode: 'create' | 'update',
  canUpdate = true,
): AdminField[] {
  if (mode === 'create' ? !type.create : !type.update) return [];
  if (mode === 'update' && !canUpdate) return [];
  return editableFields(type.fields);
}

/** The fields of a list (a type's, or an action's inputs) that have an editor. */
export function editableFields(fields: AdminField[]): AdminField[] {
  return fields.filter((f) => isWritableField(f) && editorKind(f) !== 'readonly');
}

/** Whether the record can be deleted from the app: the type's switch and the record's rule. */
export function canDestroy(type: AdminResource, record: Pick<AdminRecord, 'can'>): boolean {
  return type.destroy && record.can.destroy;
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
    const kind = editorKind(f);
    if (kind === 'boolean') {
      if (typeof draft === 'boolean') out[f.name] = draft;
      else if (f.required) out[f.name] = false;
    } else if (kind === 'image' || kind === 'file') {
      if (isAttachment(draft) && draft.signedId) out[f.name] = draft.signedId;
    } else if (!isEmpty(draft)) out[f.name] = payload(f, draft);
  }
  return out;
}

/** An action's `input`: what was filled in, with every switch sent as on or off. */
export function inputValues(fields: AdminField[], drafts: Drafts): Record<string, unknown> {
  const out = createValues(fields, drafts);
  for (const f of fields) if (editorKind(f) === 'boolean') out[f.name] = drafts[f.name] === true;
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
  if (kind === 'file') return adminFile(value)?.filename ?? '—';
  if (kind === 'link') {
    const link = adminLink(value);
    return link ? linkText(link, [], field) : '—';
  }
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
    if (field?.type === 'file' && !adminFile(value)) continue;
    parts.push(`${field?.label ?? humanize(name)}: ${displayValue(field, value)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** One of a type, for "New …" titles: the host's `singular` (gem 0.5), else made from the label. */
export function singularLabel(type: Pick<AdminResource, 'label' | 'singular'>): string {
  return type.singular ?? singular(type.label);
}

/** "Refund reasons" → "Refund reason", for "New …" titles. */
export function singular(label: string): string {
  if (/ies$/i.test(label)) return label.replace(/ies$/i, 'y');
  if (/(s|x|ch|sh)es$/i.test(label)) return label.replace(/es$/i, '');
  if (/[^s]s$/i.test(label)) return label.slice(0, -1);
  return label;
}
