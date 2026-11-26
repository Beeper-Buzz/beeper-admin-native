import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * On a phone, React Native defines `window` and no test-runner variables, so tRPC's import-time
 * "is this a server?" check fails. Reproduce that here: tests otherwise pass the check by name.
 */
describe('in a React Native-like environment', () => {
  beforeEach(() => {
    vi.stubEnv('VITEST_WORKER_ID', undefined);
    vi.stubEnv('JEST_WORKER_ID', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('window', globalThis);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('reproduces the device: plain initTRPC.create() throws', async () => {
    const { initTRPC } = await import('@trpc/server');
    expect(() => initTRPC.create()).toThrow(/non-server environment/);
  });

  it('loads the app router', async () => {
    const { appRouter } = await import('./router');
    expect(appRouter._def.procedures).toHaveProperty(['store.probe']);
  });
});
