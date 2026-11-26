import { dashboardRouter, devicesRouter } from './routers/dashboard';
import { ordersRouter } from './routers/orders';
import { storeRouter } from './routers/store';
import { createCallerFactory, router } from './trpc';

export const appRouter = router({
  store: storeRouter,
  orders: ordersRouter,
  dashboard: dashboardRouter,
  devices: devicesRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
