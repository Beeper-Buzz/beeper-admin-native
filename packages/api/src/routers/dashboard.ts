import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { requireCapability, router, storeProcedure } from '../trpc';

export const dashboardRouter = router({
  /** Home screen numbers in one request (companion gem). */
  summary: requireCapability('analytics.summary').query(({ ctx }) => {
    const companion = ctx.session.adapter.companion;
    if (!companion)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Sales summaries need the companion gem.',
      });
    return companion.summary();
  }),
});

export const devicesRouter = router({
  /** Register this device's Expo push token with the companion gem, or turn push off. */
  updatePush: storeProcedure
    .input(z.object({ pushToken: z.string().min(10).nullable(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const companion = ctx.session.adapter.companion;
      if (!companion || !ctx.session.probe.capabilities.includes('notifications.push')) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Push notifications need the companion gem.',
        });
      }
      await companion.updateCurrentDevice({ pushToken: input.pushToken, pushEnabled: input.enabled });
      return { ok: true };
    }),
});
