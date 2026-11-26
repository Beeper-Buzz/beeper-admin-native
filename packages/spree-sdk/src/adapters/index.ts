import type { ApiFamily } from '../capabilities/types';
import { companion } from '../companion';
import type { SpreeAdapter } from '../ports';
import type { Transport } from '../transport';
import { adminV3Orders } from './admin-v3/orders';
import { apiV1Orders } from './api-v1/orders';
import { platformV2Orders } from './platform-v2/orders';

export { mapOrder as mapAdminV3Order } from './admin-v3/mapOrder';
export { mapV1Order as mapApiV1Order } from './api-v1/mapOrder';
export { mapOrderDocument as mapPlatformV2Orders } from './platform-v2/mapOrder';

/** The adapter for a store's preferred API family. `transport` must already carry auth. */
export function createAdapter(
  family: ApiFamily,
  transport: Transport,
  options: { companion?: boolean } = {},
): SpreeAdapter {
  const base = baseAdapter(family, transport);
  return options.companion ? { ...base, companion: companion(transport) } : base;
}

function baseAdapter(family: ApiFamily, transport: Transport): SpreeAdapter {
  switch (family) {
    case 'api-v1':
      return { family, orders: apiV1Orders(transport) };
    case 'platform-v2':
      return { family, orders: platformV2Orders(transport) };
    case 'admin-v3':
      return { family, orders: adminV3Orders(transport) };
  }
}
