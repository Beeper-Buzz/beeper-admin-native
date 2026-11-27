import { unsupported } from '../../errors';
import type { CustomersPort, ProductsPort, PromotionsPort } from '../../ports';

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
