import { vitestPreset } from '@instincts/spree-config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    ...vitestPreset.test,
    // Inlined so device.test.ts can re-run tRPC's import-time environment check.
    server: { deps: { inline: ['@trpc/server'] } },
  },
});
