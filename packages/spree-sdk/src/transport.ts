import { extractErrorMessage, kindForStatus, parseFieldErrors, parseRetryAfter, SpreeError } from './errors';
import { encodeQuery, type QueryObject } from './query';

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  /** JSON text, or multipart form data (file uploads). */
  body?: string | FormData;
  signal?: AbortSignal;
  credentials?: 'include' | 'omit' | 'same-origin';
}

/** The subset of `fetch` we use, so tests and React Native can inject their own. */
export type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

export interface AuthStrategy {
  headers(): Promise<Record<string, string>>;
  /** Called once after a 401; the request is retried with fresh headers. */
  refresh?(): Promise<void>;
}

export interface TransportOptions {
  baseUrl: string;
  fetch?: FetchLike;
  auth?: AuthStrategy;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Send cookies (needed for the Admin API v3 refresh cookie). */
  credentials?: FetchInit['credentials'];
}

export interface TransportRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: QueryObject;
  /** Sent as JSON, except a `FormData`, which is sent as multipart with fetch's own boundary. */
  body?: unknown;
  headers?: Record<string, string>;
  /** `none` sends no auth headers (probes, login). Default `default`. */
  auth?: 'default' | 'none';
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Overrides the transport default (e.g. send the Admin v3 refresh cookie). */
  credentials?: FetchInit['credentials'];
}

export interface TransportResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface Transport {
  readonly baseUrl: string;
  request<T = unknown>(req: TransportRequest): Promise<TransportResponse<T>>;
  /** A copy with different auth (used after sign-in). */
  withAuth(auth: AuthStrategy | undefined): Transport;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

export function normaliseBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function createTransport(options: TransportOptions): Transport {
  const baseUrl = normaliseBaseUrl(options.baseUrl);
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));

  async function send(req: TransportRequest, attempt: number): Promise<TransportResponse<unknown>> {
    const qs = req.query ? encodeQuery(req.query) : '';
    const url = `${baseUrl}${req.path.startsWith('/') ? '' : '/'}${req.path}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.api+json, application/json',
      ...options.headers,
      ...(req.auth !== 'none' && options.auth ? await options.auth.headers() : {}),
      ...req.headers,
    };
    let body: string | FormData | undefined;
    if (isFormData(req.body)) {
      // fetch sets multipart/form-data with the boundary; a Content-Type set here would lose it.
      delete headers['Content-Type'];
      body = req.body;
    } else if (req.body !== undefined) {
      headers['Content-Type'] ??= 'application/json';
      body = JSON.stringify(req.body);
    }

    const controller = new AbortController();
    const timeoutMs = req.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    req.signal?.addEventListener('abort', onAbort);

    let res: Response;
    try {
      const init: FetchInit = { method: req.method ?? 'GET', headers, signal: controller.signal };
      if (body !== undefined) init.body = body;
      const credentials = req.credentials ?? options.credentials;
      if (credentials) init.credentials = credentials;
      res = await doFetch(url, init);
    } catch (cause) {
      if (timedOut) throw new SpreeError({ kind: 'timeout', status: 0, cause });
      if (req.signal?.aborted) throw cause;
      throw new SpreeError({ kind: 'network', status: 0, cause });
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }

    if (res.status === 401 && attempt === 0 && req.auth !== 'none' && options.auth?.refresh) {
      await options.auth.refresh();
      return send(req, 1);
    }

    const parsed = await readBody(res);
    if (!res.ok) {
      const kind = kindForStatus(res.status);
      const init: ConstructorParameters<typeof SpreeError>[0] = {
        kind,
        status: res.status,
        body: parsed.value,
      };
      const message = extractErrorMessage(parsed.value);
      if (message) init.message = message;
      if (kind === 'invalid') {
        const fields = parseFieldErrors(parsed.value);
        if (Object.keys(fields).length) init.fieldErrors = fields;
      }
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      if (retryAfterMs !== undefined) init.retryAfterMs = retryAfterMs;
      throw new SpreeError(init);
    }
    if (!parsed.ok) throw new SpreeError({ kind: 'parse', status: res.status, body: parsed.value });
    return { status: res.status, data: parsed.value, headers: res.headers };
  }

  const transport: Transport = {
    baseUrl,
    request: <T>(req: TransportRequest) => send(req, 0) as Promise<TransportResponse<T>>,
    withAuth: (auth) => {
      const next: TransportOptions = { ...options };
      if (auth) next.auth = auth;
      else delete next.auth;
      return createTransport(next);
    },
  };
  return transport;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

async function readBody(res: Response): Promise<{ ok: boolean; value: unknown }> {
  if (res.status === 204) return { ok: true, value: null };
  const text = await res.text();
  if (!text) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: text };
  }
}
