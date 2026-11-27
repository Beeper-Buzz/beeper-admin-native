import { unsupported } from '../../errors';
import type {
  CustomersPort,
  MediaPort,
  OrdersPort,
  ProductsPort,
  PromotionsPort,
  ResourcesPort,
} from '../../ports';

const refuse = (capability: string) => async (): Promise<never> => {
  throw unsupported(capability);
};

/** Ports for a family that doesn't implement an area yet; screens are gated by capabilities. */
export const unsupportedProducts: ProductsPort = {
  list: refuse('products.read'),
  get: refuse('products.read'),
  update: refuse('products.write'),
  updateVariant: refuse('products.write'),
  setStock: refuse('inventory.adjust'),
};

export const unsupportedCustomers: CustomersPort = {
  list: refuse('customers.read'),
  get: refuse('customers.read'),
};

export const unsupportedPromotions: PromotionsPort = {
  list: refuse('promotions.read'),
  get: refuse('promotions.read'),
  create: refuse('promotions.write'),
  update: refuse('promotions.write'),
};

export const unsupportedMedia: MediaPort = {
  list: refuse('products.media'),
  upload: refuse('products.media'),
  update: refuse('products.media'),
  move: refuse('products.media'),
  remove: refuse('products.media'),
  library: refuse('media.library'),
};

/** Host-described admin types need the companion gem 0.4+ (`admin.resources`). */
export const unsupportedResources: ResourcesPort = {
  manifest: refuse('admin.resources'),
  list: refuse('admin.resources'),
  get: refuse('admin.resources'),
  create: refuse('admin.resources'),
  update: refuse('admin.resources'),
  remove: refuse('admin.resources'),
  perform: refuse('admin.resources'),
  upload: refuse('admin.resources'),
};

/** Order creation for a family the contract suite hasn't proven (`orders.create`). */
export const unsupportedOrderCreation: Pick<
  OrdersPort,
  'createDraft' | 'updateDraft' | 'selectShippingRate' | 'paymentMethods' | 'place' | 'discardDraft'
> = {
  createDraft: refuse('orders.create'),
  updateDraft: refuse('orders.create'),
  selectShippingRate: refuse('orders.create'),
  paymentMethods: refuse('orders.create'),
  place: refuse('orders.create'),
  discardDraft: refuse('orders.create'),
};
