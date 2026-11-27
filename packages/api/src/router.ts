import { appInfoRouter } from './routers/app';
import { customersRouter } from './routers/customers';
import { dashboardRouter, devicesRouter } from './routers/dashboard';
import { mediaRouter } from './routers/media';
import { ordersRouter } from './routers/orders';
import { productsRouter } from './routers/products';
import { promotionsRouter } from './routers/promotions';
import { resourcesRouter } from './routers/resources';
import { storeRouter } from './routers/store';
import { createCallerFactory, router } from './trpc';

export const appRouter = router({
  store: storeRouter,
  orders: ordersRouter,
  promotions: promotionsRouter,
  products: productsRouter,
  media: mediaRouter,
  customers: customersRouter,
  dashboard: dashboardRouter,
  devices: devicesRouter,
  resources: resourcesRouter,
  app: appInfoRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
