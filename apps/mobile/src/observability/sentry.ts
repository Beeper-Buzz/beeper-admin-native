import type { StoreProbe } from '@instincts/spree-sdk';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * Crash and error reporting. A distribution turns it on with a Sentry DSN (distribution.json
 * `sentry.dsn` or `SENTRY_DSN` at build time); app.config.ts passes it in `extra.sentry`.
 * Nothing is sent without one, nor from the dev server.
 */
export interface SentrySettings {
  dsn: string;
  tracesSampleRate: number;
}

export function sentrySettings(extra: Record<string, unknown> | undefined = Constants.expoConfig?.extra) {
  const value = extra?.sentry as { dsn?: unknown; tracesSampleRate?: unknown } | null | undefined;
  if (!value || typeof value.dsn !== 'string' || !value.dsn) return null;
  const rate = Number(value.tracesSampleRate);
  return { dsn: value.dsn, tracesSampleRate: rate >= 0 && rate <= 1 ? rate : 0 } satisfies SentrySettings;
}

// Admin credentials travel in these; none may reach Sentry.
const SECRET_HEADER =
  /^(authorization|cookie|set-cookie|x-spree-token|x-spree-api-key|x-spree-order-token)$/i;
const SECRET_PARAM = /([?&#](?:token|access_token|refresh_token|api_key|code|order_token|password)=)[^&#]*/gi;

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
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
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

export { Sentry };
