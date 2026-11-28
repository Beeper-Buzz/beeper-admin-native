import type { ApiFamily } from '../capabilities/types';
import { type CompanionPort, companion } from '../companion';
import { companionInbox } from '../companion/inbox';
import { companionPromotions } from '../companion/promotions';
import { companionResources } from '../companion/resources';
import { companionCarts, companionVisitors } from '../companion/visitors';
import type { SpreeAdapter } from '../ports';
import type { Transport } from '../transport';
import { adminV3Customers } from './admin-v3/customers';
import { adminV3Media } from './admin-v3/media';
import { adminV3Orders } from './admin-v3/orders';
import { adminV3Products } from './admin-v3/products';
import { adminV3Promotions } from './admin-v3/promotions';
import { apiV1Customers } from './api-v1/customers';
import { apiV1Media } from './api-v1/media';
import { apiV1Orders } from './api-v1/orders';
import { apiV1Products } from './api-v1/products';
import { platformV2Orders } from './platform-v2/orders';
import {
  unsupportedCarts,
  unsupportedCustomers,
  unsupportedInbox,
  unsupportedMedia,
  unsupportedProducts,
  unsupportedPromotions,
  unsupportedResources,
  unsupportedVisitors,
} from './unsupported';

export type {
  GemAdminAction,
  GemAdminBlob,
  GemAdminField,
  GemAdminFilter,
  GemAdminRecord,
  GemAdminResource,
  GemAdminTree,
  GemAdminTreeNode,
} from '../companion/resources';
export {
  CONFLICT_MESSAGE,
  companionResources,
  mapGemBlob,
  mapGemRecord,
  mapGemResource,
  mapGemTree,
  mapGemTreeNode,
} from '../companion/resources';
export { mapOrder as mapAdminV3Order } from './admin-v3/mapOrder';
export {
  mapV3Customer as mapAdminV3Customer,
  mapV3Product as mapAdminV3Product,
} from './admin-v3/mapProduct';
export { mapV3Image } from './admin-v3/media';
export { mapV1Order as mapApiV1Order } from './api-v1/mapOrder';
export { mapV1Product as mapApiV1Product, mapV1User as mapApiV1Customer } from './api-v1/mapProduct';
export { v1Gallery } from './api-v1/media';
export { mapOrderDocument as mapPlatformV2Orders } from './platform-v2/mapOrder';
export {
  unsupportedCarts,
  unsupportedCustomers,
  unsupportedInbox,
  unsupportedMedia,
  unsupportedOrderCreation,
  unsupportedProducts,
  unsupportedPromotions,
  unsupportedResources,
  unsupportedVisitors,
} from './unsupported';

/** The adapter for a store's preferred API family. `transport` must already carry auth. */
export function createAdapter(
  family: ApiFamily,
  transport: Transport,
  options: { companion?: boolean } = {},
): SpreeAdapter {
  const gem = options.companion ? companion(transport) : undefined;
  const base = baseAdapter(family, transport, gem);
  return gem ? { ...base, companion: gem } : base;
}

// Filled in per family as each area lands (products/customers, promotions).
const pending = {
  products: unsupportedProducts,
  customers: unsupportedCustomers,
  promotions: unsupportedPromotions,
  media: unsupportedMedia,
};

function baseAdapter(family: ApiFamily, transport: Transport, gem?: CompanionPort): SpreeAdapter {
  // Host-described admin types, the inbox, carts and visitors come only from the gem, whatever the
  // family; screens gate on the capabilities the gem announces (`inbox`, `carts`, `visitors`).
  const companionOnly = {
    resources: gem ? companionResources(transport) : unsupportedResources,
    inbox: gem ? companionInbox(transport) : unsupportedInbox,
    carts: gem ? companionCarts(transport) : unsupportedCarts,
    visitors: gem ? companionVisitors(transport) : unsupportedVisitors,
  };
  switch (family) {
    case 'api-v1':
      return {
        family,
        ...pending,
        ...companionOnly,
        orders: apiV1Orders(transport, gem),
        promotions: gem ? companionPromotions(transport) : unsupportedPromotions,
        products: apiV1Products(transport, gem),
        customers: apiV1Customers(transport),
        media: apiV1Media(transport, { companion: !!gem }),
      };
    case 'platform-v2':
      return { family, orders: platformV2Orders(transport), ...pending, ...companionOnly };
    case 'admin-v3':
      return {
        family,
        ...pending,
        ...companionOnly,
        orders: adminV3Orders(transport),
        promotions: adminV3Promotions(transport),
        products: adminV3Products(transport),
        customers: adminV3Customers(transport),
        media: adminV3Media(transport),
      };
  }
}
