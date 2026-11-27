import { z } from 'zod';
import type { Transport } from '../transport';

/** What the store asks of this app on one platform (companion gem 0.6, `app.versionGate`). */
export interface AppVersionInfo {
  /** Below this the app can't be used until it is updated. Null for none. */
  minimumVersion: string | null;
  /** Below this the app asks, but doesn't force, an update. Null for none. */
  recommendedVersion: string | null;
  /** Where Update goes (App Store, TestFlight or Play link). Https only; null for none. */
  updateUrl: string | null;
  /** The gem's own verdict, false unless the app sent a version it could read. */
  updateRequired: boolean;
  updateRecommended: boolean;
}

export const APP_VERSION_TIMEOUT_MS = 5_000;

/** Blank and missing read as null, so an older or sparser gem still parses. */
const optionalText = z
  .string()
  .nullish()
  .transform((v) => (v?.trim() ? v.trim() : null));

const Payload = z.object({
  data: z.object({
    minimum_version: optionalText,
    recommended_version: optionalText,
    update_url: optionalText,
    update_required: z.boolean().nullish(),
    update_recommended: z.boolean().nullish(),
  }),
});

/** Only an https link is opened; anything else counts as no link (the gem refuses others too). */
function httpsOnly(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** The `GET app_version` body, or null when it isn't the shape the spec gives. */
export function parseAppVersion(body: unknown): AppVersionInfo | null {
  const parsed = Payload.safeParse(body);
  if (!parsed.success) return null;
  const d = parsed.data.data;
  return {
    minimumVersion: d.minimum_version,
    recommendedVersion: d.recommended_version,
    updateUrl: httpsOnly(d.update_url),
    updateRequired: d.update_required ?? false,
    updateRecommended: d.update_recommended ?? false,
  };
}

/** Public endpoint: no auth, a 5 s timeout and null on every failure, so the gate fails open. */
export async function fetchAppVersion(
  transport: Transport,
  platform: string,
  version?: string | null,
): Promise<AppVersionInfo | null> {
  try {
    const query: Record<string, string> = { platform };
    if (version) query.version = version;
    const res = await transport.request({
      path: '/api/admin_native/v1/app_version',
      query,
      auth: 'none',
      timeoutMs: APP_VERSION_TIMEOUT_MS,
    });
    return parseAppVersion(res.data);
  } catch {
    return null;
  }
}
