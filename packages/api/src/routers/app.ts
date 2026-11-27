import type { AppVersionInfo } from '@instincts/spree-sdk';
import { z } from 'zod';
import { router, storeProcedure } from '../trpc';

/** About this app, as the connected store sees it. */
export const appInfoRouter = router({
  /**
   * The store's minimum and recommended versions of this app (companion gem 0.6, `app.versionGate`).
   * Null when the store has no version gate or the check fails, so the gate fails open. It never
   * throws for a missing capability: the app checks quietly in the background.
   */
  version: storeProcedure
    .input(
      z.object({
        platform: z.string().trim().min(1).max(20),
        version: z.string().trim().max(40).nullable(),
      }),
    )
    .query(async ({ ctx, input }): Promise<AppVersionInfo | null> => {
      const companion = ctx.session.adapter.companion;
      if (!companion || !ctx.session.probe.capabilities.includes('app.versionGate')) return null;
      return companion.appVersion(input.platform, input.version || null);
    }),
});
