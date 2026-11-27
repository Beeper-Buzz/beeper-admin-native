import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import type { DistributionConfig } from '../../distributions/types';

// Load the selected distribution's pure-data config (no imports beyond types). See docs/forking.md.
const name = process.env.APP_DISTRIBUTION || 'default';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const distribution: DistributionConfig = require(`../../distributions/${name}/distribution.json`);

const asset = (key: keyof NonNullable<DistributionConfig['assets']>, fallback: string) => {
  const own = distribution.assets?.[key];
  return own ? path.join('..', '..', 'distributions', name, own) : fallback;
};
const projectId = distribution.eas?.projectId;

// Sentry: off without a DSN; uploads source maps only when the org and project are known too.
const sentry = distribution.sentry ?? {};
const sentryDsn = process.env.SENTRY_DSN || sentry.dsn;
const sentryOrg = process.env.SENTRY_ORG || sentry.organization;
const sentryProject = process.env.SENTRY_PROJECT || sentry.project;
const sentryPlugin: [string, Record<string, string>][] =
  sentryOrg && sentryProject
    ? [
        [
          '@sentry/react-native/expo',
          { url: sentry.url ?? 'https://sentry.io/', organization: sentryOrg, project: sentryProject },
        ],
      ]
    : [];

const CAMERA_PERMISSION =
  'Scan pairing codes from your store admin and take photos for your products and store content.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: distribution.name,
  slug: distribution.slug,
  ...(distribution.eas?.owner ? { owner: distribution.eas.owner } : {}),
  scheme: distribution.scheme,
  version: distribution.version ?? '0.1.0',
  // OTA updates only reach builds with the same native code: the runtime version is a
  // fingerprint of native dependencies and config, so adding a native module (or changing a
  // plugin) needs a new build, and an update can never land on a build that lacks its modules.
  runtimeVersion: { policy: 'fingerprint' },
  ...(projectId ? { updates: { url: `https://u.expo.dev/${projectId}` } } : {}),
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  icon: asset('icon', './assets/images/icon.png'),
  ios: {
    bundleIdentifier: distribution.ios.bundleIdentifier,
    ...(distribution.ios.appleTeamId ? { appleTeamId: distribution.ios.appleTeamId } : {}),
    supportsTablet: true,
    // HTTPS only, no custom crypto: exempt from export documentation.
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: distribution.android.package,
    adaptiveIcon: {
      backgroundColor: distribution.brandColor,
      foregroundImage: asset('adaptiveIconForeground', './assets/images/android-icon-foreground.png'),
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  web: { output: 'single', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    // expo-camera and expo-image-picker both write the camera prompt; keep their wording the same.
    ['expo-camera', { cameraPermission: CAMERA_PERMISSION, recordAudioAndroid: false }],
    [
      'expo-image-picker',
      {
        cameraPermission: CAMERA_PERMISSION,
        photosPermission: 'Choose photos from your library to add to your products and store content.',
        microphonePermission: false,
      },
    ],
    ['expo-notifications', { color: distribution.brandColor }],
    [
      'expo-splash-screen',
      {
        backgroundColor: distribution.brandColor,
        image: asset('splash', './assets/images/splash-icon.png'),
        imageWidth: 76,
      },
    ],
    ...sentryPlugin,
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    distribution: name,
    ...(projectId ? { eas: { projectId } } : {}),
    sentry: sentryDsn
      ? { dsn: sentryDsn, tracesSampleRate: sentry.tracesSampleRate ?? 0.1, logs: sentry.logs ?? true }
      : null,
  },
});
