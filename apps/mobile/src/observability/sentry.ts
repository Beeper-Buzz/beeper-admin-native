import type { StoreProbe } from '@instincts/spree-sdk';
import * as Sentry from '@sentry/react-native';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * Crash and error reporting. A distribution turns it on with a Sentry DSN (distribution.json
 * `sentry.dsn` or `SENTRY_DSN` at build time); app.config.ts passes it in `extra.sentry`.
 * Nothing is sent without one, nor from the dev server.
 */
export interface SentrySettings {
  dsn: string;
  /** Share of sessions that send traces. */
  tracesSampleRate: number;
  /** Send console warnings and errors and Sentry.logger output as logs. */
  logs: boolean;
}

export function sentrySettings(extra: Record<string, unknown> | undefined = Constants.expoConfig?.extra) {
  const value = extra?.sentry as
    | { dsn?: unknown; tracesSampleRate?: unknown; logs?: unknown }
    | null
    | undefined;
  if (!value || typeof value.dsn !== 'string' || !value.dsn) return null;
  const rate = value.tracesSampleRate === undefined ? 0.1 : Number(value.tracesSampleRate);
  return {
    dsn: value.dsn,
    tracesSampleRate: rate >= 0 && rate <= 1 ? rate : 0,
    logs: value.logs !== false,
  } satisfies SentrySettings;
}

// Admin credentials travel in these; none may reach Sentry.
const SECRET_HEADER =
  /^(authorization|cookie|set-cookie|x-spree-token|x-spree-api-key|x-spree-order-token)$/i;
const SECRET_PARAM =
  /([?&#](?:token|access_token|refresh_token|api_key|code|order_token|password)=)[^&#\s]*/gi;

export function scrubUrl(url: string): string {
  return url.replace(SECRET_PARAM, '$1[Filtered]');
}

function scrubHeaders(headers: Record<string, string> | undefined) {
  if (!headers) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, SECRET_HEADER.test(k) ? '[Filtered]' : v]),
  );
}

export function scrubEvent<E extends Sentry.ErrorEvent>(event: E): E {
  if (event.request) {
    event.request.headers = scrubHeaders(event.request.headers);
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = scrubUrl(`?${event.request.query_string}`).slice(1);
    }
    delete event.request.cookies;
    delete event.request.data;
  }
  event.breadcrumbs = event.breadcrumbs?.map(scrubBreadcrumb);
  return event;
}

export function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const url = crumb.data?.url;
  if (typeof url === 'string') crumb.data = { ...crumb.data, url: scrubUrl(url) };
  return crumb;
}

type SentryLog = Parameters<NonNullable<Sentry.ReactNativeOptions['beforeSendLog']>>[0];

export function scrubLog(log: SentryLog): SentryLog {
  const message = typeof log.message === 'string' ? scrubUrl(log.message) : log.message;
  const attributes = log.attributes
    ? Object.fromEntries(
        Object.entries(log.attributes).map(([k, v]) => [k, typeof v === 'string' ? scrubUrl(v) : v]),
      )
    : log.attributes;
  return { ...log, message, attributes };
}

let started = false;

/** Starts Sentry once. Returns whether reporting is on. */
export function startSentry(settings: SentrySettings | null = sentrySettings()): boolean {
  if (started) return true;
  if (!settings) return false;
  Sentry.init({
    dsn: settings.dsn,
    // Keeps preview builds' errors apart from production's.
    environment: Updates.channel || (__DEV__ ? 'development' : 'production'),
    enabled: !__DEV__,
    // Staff accounts and customer data stay out: no IP address, cookies or request bodies.
    sendDefaultPii: false,
    tracesSampleRate: settings.tracesSampleRate,
    enableLogs: settings.logs,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendLog: scrubLog,
    integrations: [
      // Screen loads and navigation timings, named by route.
      Sentry.expoRouterIntegration({ enableTimeToInitialDisplay: !isRunningInExpoGo() }),
      ...(settings.logs ? [Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })] : []),
    ],
    enableNativeFramesTracking: !isRunningInExpoGo(),
  });
  started = true;
  return true;
}

/** Tags errors with the connected store's host and API family (not the account). */
export function tagStore(probe: Pick<StoreProbe, 'baseUrl' | 'preferredApi' | 'spreeVersion'> | null) {
  if (!started) return;
  Sentry.setTag('store_host', probe ? probe.baseUrl.replace(/^https?:\/\//, '').split('/')[0] : null);
  Sentry.setTag('spree_api', probe?.preferredApi ?? null);
  Sentry.setTag('spree_version', probe?.spreeVersion ?? null);
}

/**
 * A breadcrumb for the app version gate. Breadcrumbs only: a gate that closes, or a check that
 * fails open, is not an error. Sentry drops them while it is off.
 */
export function versionGateBreadcrumb(message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({ category: 'version-gate', level: 'info', message, ...(data ? { data } : {}) });
}

/** Error kinds that are the user's or the network's, not a defect: shown in the UI, not reported. */
const EXPECTED_KINDS = new Set([
  'auth',
  'forbidden',
  'offline',
  'timeout',
  'network',
  'notFound',
  'invalid',
  'conflict',
  'rateLimited',
  'capability',
]);

/**
 * Reports a failed API call when it points at a defect: the store answered 5xx, sent something
 * the app couldn't parse, or the app's own router threw. Tagged with the tRPC procedure and the
 * Spree error kind. Returns whether it was reported.
 */
export function reportApiError(error: unknown): boolean {
  if (!started) return false;
  const data = (
    error as { data?: { spreeKind?: string | null; path?: string; code?: string; httpStatus?: number } }
  )?.data;
  const kind = data?.spreeKind ?? null;
  if (kind && EXPECTED_KINDS.has(kind)) return false;
  if (!kind && data?.code && data.code !== 'INTERNAL_SERVER_ERROR') return false;
  Sentry.captureException(error, {
    tags: { api_procedure: data?.path ?? 'unknown', spree_kind: kind ?? 'none' },
    ...(data?.httpStatus ? { contexts: { api: { httpStatus: data.httpStatus } } } : {}),
  });
  return true;
}

export { Sentry };
