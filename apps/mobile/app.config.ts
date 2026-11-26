import type { ConfigContext, ExpoConfig } from 'expo/config';
import type { DistributionConfig } from '../../distributions/types';

// Load the selected distribution's pure-data config (no imports beyond types). See docs/forking.md.
const name = process.env.APP_DISTRIBUTION || 'default';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const distribution: DistributionConfig = require(`../../distributions/${name}/distribution.json`);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: distribution.name,
  slug: distribution.slug,
  scheme: distribution.scheme,
  version: '0.0.1',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  ios: { bundleIdentifier: distribution.ios.bundleIdentifier, supportsTablet: true },
  android: {
    package: distribution.android.package,
    adaptiveIcon: {
      backgroundColor: distribution.brandColor,
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  web: { output: 'single', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-camera',
      { cameraPermission: 'Scan the pairing code shown in your Spree admin.', recordAudioAndroid: false },
    ],
    ['expo-notifications', { color: distribution.brandColor }],
    [
      'expo-splash-screen',
      { backgroundColor: distribution.brandColor, image: './assets/images/splash-icon.png', imageWidth: 76 },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    distribution: name,
    ...(distribution.eas?.projectId ? { eas: { projectId: distribution.eas.projectId } } : {}),
  },
});
