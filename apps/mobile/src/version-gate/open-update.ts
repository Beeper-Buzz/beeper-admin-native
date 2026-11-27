import { Linking } from 'react-native';
import { versionGateBreadcrumb } from '@/observability/sentry';

/** Opens the store's update link (App Store, TestFlight or Play), or the distribution's listing. */
export async function openUpdate(url: string, from: 'required' | 'recommended'): Promise<void> {
  versionGateBreadcrumb('Update opened', { from });
  try {
    await Linking.openURL(url);
  } catch {
    // Nothing on the device handles the link; the screen stays and Switch store still works.
    versionGateBreadcrumb("Update link didn't open", { from });
  }
}
