/**
 * Which admin API a store speaks (infra/spree/FINDINGS.md):
 * - `api-v1`: legacy REST API, Spree 4.2–4.3 (and still present later in 4.x)
 * - `platform-v2`: Platform API, Spree 4.4–5.x (orders arrived in 4.4.0)
 * - `admin-v3`: Admin API, Spree 5.4+ and 6.x
 */
export type ApiFamily = 'api-v1' | 'platform-v2' | 'admin-v3';

export type AuthMethod =
  /** Email + password: admin JWT login (Admin v3). */
  | 'password'
  /** OAuth application client id + secret (Platform v2 client credentials, Spree 4.3+). */
  | 'oauthClient'
  /** Secret Admin API key `sk_…` (Admin v3). */
  | 'apiKey'
  /** A user's Spree API key, sent as X-Spree-Token (API v1). */
  | 'spreeToken'
  /** QR pairing through the companion gem. */
  | 'pairing';

/** Core capabilities. Extensions add namespaced strings such as `beeper.moderation`. */
export const CORE_CAPABILITIES = [
  'orders.read',
  'orders.create',
  'orders.cancel',
  'orders.capture',
  'orders.refund',
  'orders.note',
  'shipments.ship',
  'products.read',
  'products.write',
  'products.media',
  'media.library',
  'inventory.adjust',
  'inventory.lowStock',
  'customers.read',
  'customers.write',
  'promotions.read',
  'promotions.write',
  'settings.store',
  'settings.shipping',
  'settings.tax',
  'settings.payments',
  'analytics.summary',
  'notifications.push',
  'webhooks.manage',
  'markets',
  'priceLists',
  'giftCards',
  'channels',
  /** Host-described admin types (companion gem 0.4+). */
  'admin.resources',
  /** The store sets minimum and recommended app versions (companion gem 0.6+, `GET app_version`). */
  'app.versionGate',
] as const;
export type CoreCapability = (typeof CORE_CAPABILITIES)[number];
/** A core capability or an extension's namespaced capability (`vendor.feature`). */
export type Capability = CoreCapability | `${string}.${string}`;

export interface GemInfo {
  version: string;
}

export interface StoreProbe {
  baseUrl: string;
  apiFamilies: ApiFamily[];
  preferredApi: ApiFamily;
  capabilities: Capability[];
  authMethods: AuthMethod[];
  storeName: string | null;
  currency: string | null;
  spreeVersion: string | null;
  gem: GemInfo | null;
  probedAt: string;
}
