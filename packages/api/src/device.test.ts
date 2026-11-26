import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * On a phone, React Native defines `window` and no test-runner variables, so tRPC's import-time
 * "is this a server?" check fails. Reproduce that here: tests otherwise pass the check by name.
 */
describe('in a React Native-like environment', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.VITEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    process.env.NODE_ENV = 'production';
    (globalThis as { window?: unknown }).window = globalThis;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...saved };
    delete (globalThis as { window?: unknown }).window;
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
