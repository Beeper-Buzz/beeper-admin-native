import { unsupported } from '../../errors';
import type {
  CartsPort,
  CustomersPort,
  InboxPort,
  MediaPort,
  OrdersPort,
  ProductsPort,
  PromotionsPort,
  ResourcesPort,
  VisitorsPort,
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
  tree: refuse('admin.resources'),
  moveTree: refuse('admin.resources'),
};

/** The inbox needs the companion gem 0.7 with a host inbox adapter (`inbox`). */
export const unsupportedInbox: InboxPort = {
  list: refuse('inbox'),
  get: refuse('inbox'),
  messages: refuse('inbox'),
  reply: refuse('inbox'),
  update: refuse('inbox'),
  markRead: refuse('inbox'),
  summary: refuse('inbox'),
};

/** Carts need the companion gem 0.7 (`carts`). */
export const unsupportedCarts: CartsPort = {
  list: refuse('carts'),
  get: refuse('carts'),
};

/** Visitors need the companion gem 0.7 with a host visitors adapter (`visitors`). */
export const unsupportedVisitors: VisitorsPort = {
  list: refuse('visitors'),
  get: refuse('visitors'),
  startConversation: refuse('visitors'),
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
