import type { ApiFamily, AuthMethod, Capability } from './types';

/**
 * What each API family is assumed to offer before contract tests say otherwise.
 * The contract suite (packages/spree-sdk/contract) proves or removes each entry per Spree
 * version; keep these conservative.
 */
export const FAMILY_CAPABILITIES: Record<ApiFamily, readonly Capability[]> = {
  // Routes confirmed on 4.2.7 (FINDINGS.md §b). No refunds: v1 only has payments/:id/credit.
  // Products (status derived from available_on/discontinue_on), stock and users proven in §g.
  'api-v1': [
    'orders.read',
    'orders.cancel',
    'orders.capture',
    'shipments.ship',
    'inventory.adjust',
    'products.read',
    'products.write',
    'customers.read',
  ],
  // Read-only until a Platform v2 store is in the contract suite (actions throw `capability`).
  'platform-v2': [
    'orders.read',
    'products.read',
    'products.write',
    'inventory.adjust',
    'customers.read',
    'promotions.read',
    'webhooks.manage',
  ],
  'admin-v3': [
    'orders.read',
    'orders.cancel',
    'orders.capture',
    'orders.refund',
    'orders.note',
    'shipments.ship',
    'products.read',
    'products.write',
    'products.media',
    'inventory.adjust',
    'customers.read',
    'customers.write',
    'promotions.read',
    'promotions.write',
    'settings.store',
    'analytics.summary',
    'webhooks.manage',
    'channels',
  ],
};

export const FAMILY_AUTH: Record<ApiFamily, readonly AuthMethod[]> = {
  // 4.2 has no grant that reaches admin data; the user's API key is the only way (FINDINGS.md §a).
  'api-v1': ['spreeToken'],
  // Platform v2 needs a token bound to an OAuth application with the admin scope.
  'platform-v2': ['oauthClient'],
  'admin-v3': ['password', 'apiKey'],
};
