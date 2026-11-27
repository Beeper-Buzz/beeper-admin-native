import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';

/**
 * The native app's own version (`CFBundleShortVersionString` / Android `versionName`), which is
 * what the store's minimum applies to.
 *
 * Read from expo-application's native module (`ExpoApplication.nativeApplicationVersion`) without
 * importing the package: expo-notifications depends on it, so it is autolinked into every build,
 * but adding it to package.json would change the runtime fingerprint and keep this from shipping
 * as an update. Falls back to the app config's version when the native module is missing (web).
 */
export function installedVersion(): string | null {
  try {
    const native = requireOptionalNativeModule<{ nativeApplicationVersion?: string | null }>(
      'ExpoApplication',
    );
    if (native?.nativeApplicationVersion) return native.nativeApplicationVersion;
  } catch {
    // Fall through to the config version.
  }
  return Constants.expoConfig?.version ?? null;
}
