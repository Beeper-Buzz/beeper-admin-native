import * as Sentry from '@sentry/react-native';
import {
  reportApiError,
  scrubBreadcrumb,
  scrubEvent,
  scrubLog,
  scrubUrl,
  sentrySettings,
  startSentry,
} from '@/observability/sentry';

describe('sentrySettings', () => {
  it('is off without a DSN', () => {
    expect(sentrySettings({})).toBeNull();
    expect(sentrySettings({ sentry: null })).toBeNull();
    expect(sentrySettings({ sentry: { dsn: '' } })).toBeNull();
  });

  it('reads the DSN and clamps the trace rate', () => {
    expect(
      sentrySettings({
        sentry: { dsn: 'https://k@o1.ingest.sentry.io/2', tracesSampleRate: 0.2, logs: false },
      }),
    ).toEqual({ dsn: 'https://k@o1.ingest.sentry.io/2', tracesSampleRate: 0.2, logs: false });
    expect(
      sentrySettings({ sentry: { dsn: 'https://k@o1.ingest.sentry.io/2', tracesSampleRate: 7 } })
        ?.tracesSampleRate,
    ).toBe(0);
  });
});

describe('scrubbing', () => {
  it('filters credentials in URLs', () => {
    expect(scrubUrl('https://shop.example.com/api/v1/orders?token=abc&page=2')).toBe(
      'https://shop.example.com/api/v1/orders?token=[Filtered]&page=2',
    );
    expect(scrubUrl('https://x.example.com/cb?code=123#access_token=zzz')).toBe(
      'https://x.example.com/cb?code=[Filtered]#access_token=[Filtered]',
    );
  });

  it('filters credential headers, cookies and bodies from events', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://shop.example.com/api/v3/admin/orders?api_key=sk_live',
        headers: { Authorization: 'Bearer jwt', 'X-Spree-Token': 'key', Accept: 'application/json' },
        cookies: { spree_admin_refresh_token: 'r' },
        data: { password: 'p' },
      },
      breadcrumbs: [{ category: 'fetch', data: { url: 'https://shop.example.com/a?token=t' } }],
    });
    expect(event.request?.headers).toEqual({
      Authorization: '[Filtered]',
      'X-Spree-Token': '[Filtered]',
      Accept: 'application/json',
    });
    expect(event.request?.url).toBe('https://shop.example.com/api/v3/admin/orders?api_key=[Filtered]');
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.breadcrumbs?.[0]?.data?.url).toBe('https://shop.example.com/a?token=[Filtered]');
  });

  it('filters credentials in log messages and attributes', () => {
    const log = scrubLog({
      level: 'warn',
      message: 'GET https://shop.example.com/api?token=abc failed',
      attributes: { url: 'https://shop.example.com/x?api_key=k', status: 500 },
    });
    expect(log.message).toBe('GET https://shop.example.com/api?token=[Filtered] failed');
    expect(log.attributes).toEqual({ url: 'https://shop.example.com/x?api_key=[Filtered]', status: 500 });
  });

  it('leaves breadcrumbs without URLs alone', () => {
    expect(scrubBreadcrumb({ category: 'ui.click', message: 'Orders' })).toEqual({
      category: 'ui.click',
      message: 'Orders',
    });
  });
});

describe('startSentry', () => {
  it('does nothing without settings', () => {
    expect(startSentry(null)).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('starts with privacy defaults and the scrubbers', () => {
    expect(startSentry({ dsn: 'https://k@o1.ingest.sentry.io/2', tracesSampleRate: 0.1, logs: true })).toBe(
      true,
    );
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://k@o1.ingest.sentry.io/2',
        sendDefaultPii: false,
        beforeSend: scrubEvent,
      }),
    );
  });
});

describe('reportApiError (after start)', () => {
  const err = (data: Record<string, unknown>) => Object.assign(new Error('x'), { data });

  it('reports store 5xx, parse failures and router crashes, tagged with the procedure', () => {
    expect(reportApiError(err({ spreeKind: 'server', path: 'customers.list', httpStatus: 500 }))).toBe(true);
    expect(Sentry.captureException).toHaveBeenLastCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { api_procedure: 'customers.list', spree_kind: 'server' } }),
    );
    expect(reportApiError(err({ spreeKind: 'parse', path: 'orders.get' }))).toBe(true);
    expect(reportApiError(err({ spreeKind: null, code: 'INTERNAL_SERVER_ERROR', path: 'x' }))).toBe(true);
  });

  it('leaves expected failures to the UI', () => {
    for (const spreeKind of ['auth', 'offline', 'invalid', 'notFound', 'capability', 'rateLimited']) {
      expect(reportApiError(err({ spreeKind, path: 'x' }))).toBe(false);
    }
    expect(reportApiError(err({ spreeKind: null, code: 'BAD_REQUEST', path: 'x' }))).toBe(false);
    expect(reportApiError(err({ spreeKind: null, code: 'PRECONDITION_FAILED', path: 'x' }))).toBe(false);
  });
});
