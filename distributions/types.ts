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
}

/**
 * Font family name → asset, loaded with expo-font at startup. Require single weights by file
 * (`@expo-google-fonts/x/500Medium/X_500Medium.ttf`); a font package index bundles every weight.
 */
export type FontAssets = Record<string, number>;
