/** What a distribution (the upstream app or a fork) configures. Pure data: read by app.config.ts and at runtime. */
export interface DistributionConfig {
  /** Display name on the home screen and in the app. */
  name: string;
  slug: string;
  /** Deep-link scheme. */
  scheme: string;
  /** Marketing version shown in the stores (build numbers are managed remotely by EAS). */
  version?: string;
  ios: { bundleIdentifier: string; appleTeamId?: string };
  android: { package: string };
  /** The distribution's own Expo project; forks never share upstream's. */
  eas?: { projectId?: string; owner?: string };
  /** Paths relative to the distribution folder; fall back to the app's placeholder art. */
  assets?: { icon?: string; adaptiveIconForeground?: string; splash?: string };
  /** Pre-fills Connect. */
  defaultStoreUrl: string | null;
  /** Hide "add another store" (single-store forks). */
  lockToStore: boolean;
  /** Splash and adaptive-icon background. */
  brandColor: string;
  /** Crash and error reporting with Sentry. Off unless a DSN is set. See docs/forking.md. */
  sentry?: SentryConfig;
}

export interface SentryConfig {
  /** Client key; public by design, since it ships inside the app. `SENTRY_DSN` at build time overrides it. */
  dsn?: string;
  /**
   * Organization and project slugs. With both set (or `SENTRY_ORG` / `SENTRY_PROJECT`), builds upload
   * source maps and debug symbols, which needs the `SENTRY_AUTH_TOKEN` secret on the EAS project.
   */
  organization?: string;
  project?: string;
  /** Self-hosted Sentry. Default: https://sentry.io/ */
  url?: string;
  /** Share of sessions (0–1) that send performance traces. Default 0: errors only. */
  tracesSampleRate?: number;
}

/**
 * Font family name → asset, loaded with expo-font at startup. Require single weights by file
 * (`@expo-google-fonts/x/500Medium/X_500Medium.ttf`); a font package index bundles every weight.
 */
export type FontAssets = Record<string, number>;
