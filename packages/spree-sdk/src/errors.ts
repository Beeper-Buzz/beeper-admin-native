/**
 * Error kinds shared with BeeperNative's request layer (src/api/http/errors.ts), plus
 * `notSpree` and `capability` for the admin app.
 */
export type SpreeErrorKind =
  /** No response and the app already knows it is offline. */
  | 'offline'
  /** No response within the timeout. */
  | 'timeout'
  /** No response: DNS, TLS, connection refused. */
  | 'network'
  /** 401 after one token refresh, or no credentials for a call that needs them. */
  | 'auth'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  /** 400 / 422 and other 4xx: the request was refused. `fieldErrors` when the body names fields. */
  | 'invalid'
  /** 429; `retryAfterMs` from Retry-After when present. */
  | 'rateLimited'
  | 'server'
  /** A body that could not be read as JSON. */
  | 'parse'
  /** The address answered but exposes no Spree API we recognise. */
  | 'notSpree'
  /** The store lacks a capability the call needs. */
  | 'capability';

export interface SpreeErrorInit {
  kind: SpreeErrorKind;
  status: number;
  message?: string;
  body?: unknown;
  retryAfterMs?: number;
  fieldErrors?: Record<string, string[]>;
  cause?: unknown;
}

export class SpreeError extends Error {
  readonly kind: SpreeErrorKind;
  /** HTTP status; 0 when there was no response. */
  readonly status: number;
  readonly body: unknown;
  readonly retryAfterMs?: number;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(init: SpreeErrorInit) {
    super(init.message || defaultMessage(init.kind, init.status), { cause: init.cause });
    this.name = 'SpreeError';
    this.kind = init.kind;
    this.status = init.status;
    this.body = init.body ?? null;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
    if (init.fieldErrors !== undefined) this.fieldErrors = init.fieldErrors;
  }
}

export const isSpreeError = (e: unknown): e is SpreeError =>
  e instanceof SpreeError ||
  (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'SpreeError');

export const NO_RESPONSE_KINDS: ReadonlySet<SpreeErrorKind> = new Set(['offline', 'timeout', 'network']);

function defaultMessage(kind: SpreeErrorKind, status: number): string {
  switch (kind) {
    case 'offline':
      return 'You are offline.';
    case 'timeout':
      return 'The store took too long to answer.';
    case 'network':
      return "Couldn't reach the store. Check the address and your connection.";
    case 'auth':
      return 'Your session has ended. Sign in again.';
    case 'forbidden':
      return "Your account doesn't have permission to do that.";
    case 'notFound':
      return 'Not found.';
    case 'parse':
      return 'The store sent a response the app could not read.';
    case 'notSpree':
      return "This address doesn't look like a Spree store (no Platform or Admin API found).";
    default:
      return `Request failed (${status}).`;
  }
}

export function kindForStatus(status: number): SpreeErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'server';
  return 'invalid';
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Readable message from Spree (`{ error }`), Rails (`{ errors: { field: [msg] } }`) or JSON:API bodies. */
export function extractErrorMessage(data: unknown): string | undefined {
  if (!isObject(data)) return undefined;
  if (typeof data.error === 'string' && data.error) return data.error;
  // Spree 5.4+/6 v3 APIs: { error: { code, message } }
  if (isObject(data.error) && typeof data.error.message === 'string' && data.error.message)
    return data.error.message;
  const errors = data.errors;
  if (Array.isArray(errors)) {
    const first = errors.find((e) => isObject(e) && (e.detail || e.title)) as
      | Record<string, unknown>
      | undefined;
    const msg = first?.detail ?? first?.title;
    return typeof msg === 'string' ? msg : undefined;
  }
  if (isObject(errors)) {
    const key = errors.base ? 'base' : Object.keys(errors)[0];
    const val = key ? errors[key] : undefined;
    if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
    if (typeof val === 'string') return val;
  }
  if (typeof data.message === 'string' && data.message) return data.message;
  // Spree 4 API v1 when a model raises: { exception: "Validation failed: …" }
  if (typeof data.exception === 'string' && data.exception) return data.exception;
  return undefined;
}

/**
 * Field errors from Rails `{ errors: { field: [msg] } }`, JSON:API `errors: [{ detail, source: { pointer } }]`
 * or the companion gem's `{ error: { code, message, fields: { field: [msg] } } }`.
 */
export function parseFieldErrors(body: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!isObject(body)) return out;
  const raw = body.errors ?? (isObject(body.error) ? body.error.fields : undefined);
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isObject(item)) continue;
      const pointer =
        isObject(item.source) && typeof item.source.pointer === 'string' ? item.source.pointer : '';
      const field = pointer.split('/').filter(Boolean).pop();
      const msg =
        typeof item.detail === 'string' ? item.detail : typeof item.title === 'string' ? item.title : '';
      if (field && msg) {
        out[field] ??= [];
        out[field].push(msg);
      }
    }
    return out;
  }
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const list = Array.isArray(v)
      ? v.filter((m): m is string => typeof m === 'string' && !!m)
      : typeof v === 'string' && v
        ? [v]
        : [];
    if (list.length) out[k] = list;
  }
  return out;
}

/** Retry-After in ms: delta seconds or an HTTP date. */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number.parseFloat(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** For an action this store's API can't do. */
export function unsupported(capability: string): SpreeError {
  return new SpreeError({
    kind: 'capability',
    status: 0,
    message: `This store's API can't do ${capability}.`,
  });
}
