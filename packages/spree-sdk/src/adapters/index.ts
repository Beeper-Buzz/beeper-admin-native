import type { ApiFamily } from '../capabilities/types';
import { type CompanionPort, companion } from '../companion';
import { companionPromotions } from '../companion/promotions';
import { companionResources } from '../companion/resources';
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
  unsupportedCustomers,
  unsupportedMedia,
  unsupportedProducts,
  unsupportedPromotions,
  unsupportedResources,
} from './unsupported';

export { companionResources, mapGemRecord, mapGemResource } from '../companion/resources';
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
  unsupportedCustomers,
  unsupportedMedia,
  unsupportedOrderCreation,
  unsupportedProducts,
  unsupportedPromotions,
  unsupportedResources,
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
  // Host-described admin types come only from the gem, whatever the family.
  const resources = gem ? companionResources(transport) : unsupportedResources;
  switch (family) {
    case 'api-v1':
      return {
        family,
        ...pending,
        resources,
        orders: apiV1Orders(transport, gem),
        promotions: gem ? companionPromotions(transport) : unsupportedPromotions,
        products: apiV1Products(transport, gem),
        customers: apiV1Customers(transport),
        media: apiV1Media(transport, { companion: !!gem }),
      };
    case 'platform-v2':
      return { family, orders: platformV2Orders(transport), ...pending, resources };
    case 'admin-v3':
      return {
        family,
        ...pending,
        resources,
        orders: adminV3Orders(transport),
        promotions: adminV3Promotions(transport),
        products: adminV3Products(transport),
        customers: adminV3Customers(transport),
        media: adminV3Media(transport),
      };
  }
}
