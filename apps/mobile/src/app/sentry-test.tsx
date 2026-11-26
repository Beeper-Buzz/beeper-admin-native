/**
 * TEMPORARY: proves a release build reports to Sentry. Open `<scheme>://sentry-test` on the device;
 * the render error goes through the root ErrorBoundary, which sends it. Remove after verifying.
 */
export default function SentryTest(): never {
  throw new Error(`Sentry test error ${Date.now()}`);
}
