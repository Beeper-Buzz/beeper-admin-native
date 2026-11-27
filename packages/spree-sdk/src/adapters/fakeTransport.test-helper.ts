import { SpreeError } from '../errors';
import { encodeQuery } from '../query';
import type { Transport, TransportRequest } from '../transport';

export interface RecordedCall {
  method: string;
  /** Path plus encoded query, decoded for readable assertions. */
  url: string;
  body: unknown;
  headers: Record<string, string> | undefined;
}

/**
 * A Transport that answers from `route(method, url, body)`. Return `undefined` for a 404.
 * Calls are recorded with their query decoded (`/api/v1/products?q[s]=id desc&page=1`).
 */
export function fakeTransport(route: (method: string, url: string, body: unknown) => unknown) {
  const calls: RecordedCall[] = [];
  const transport: Transport = {
    baseUrl: 'https://shop.test',
    async request<T>(req: TransportRequest) {
      const qs = req.query ? decodeURIComponent(encodeQuery(req.query)) : '';
      const url = `${req.path}${qs ? `?${qs}` : ''}`;
      const method = req.method ?? 'GET';
      calls.push({ method, url, body: req.body, headers: req.headers });
      const data = route(method, url, req.body);
      if (data === undefined) throw new SpreeError({ kind: 'notFound', status: 404 });
      return { status: 200, data: data as T, headers: new Headers() };
    },
    withAuth: () => transport,
  };
  return { transport, calls };
}
