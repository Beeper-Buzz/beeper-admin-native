import {
  adminJwt,
  apiKeyAuth,
  oauthClientCredentials,
  oauthPasswordGrant,
  type SessionAuth,
  spreeTokenAuth,
} from '../src/auth';
import type { ApiFamily } from '../src/capabilities/types';
import { exchangePairingCode } from '../src/companion';
import { createTransport, type Transport } from '../src/transport';

/**
 * Contract tests run against a live store described by env vars:
 *   SPREE_URL, SPREE_LABEL (e.g. "4.2"), SPREE_EXPECT_FAMILY (platform-v2 | admin-v3)
 *   and one of: SPREE_TOKEN (API v1) | SPREE_API_KEY (Admin v3) | SPREE_CLIENT_ID + SPREE_CLIENT_SECRET
 *   | SPREE_EMAIL + SPREE_PASSWORD (Admin v3 JWT login, or Platform v2 password grant)
 */
export const env = {
  url: process.env.SPREE_URL ?? '',
  label: process.env.SPREE_LABEL ?? 'unknown',
  family: process.env.SPREE_EXPECT_FAMILY as ApiFamily | undefined,
};

export const enabled = env.url !== '';

export async function signIn(transport: Transport): Promise<SessionAuth> {
  const e = process.env;
  if (e.SPREE_PAIRING_CODE) {
    const paired = await exchangePairingCode(transport, {
      code: e.SPREE_PAIRING_CODE,
      deviceName: 'Contract test',
      platform: 'ci',
    });
    return spreeTokenAuth(paired.token);
  }
  if (e.SPREE_TOKEN) return spreeTokenAuth(e.SPREE_TOKEN);
  if (e.SPREE_API_KEY) return apiKeyAuth(e.SPREE_API_KEY);
  if (e.SPREE_CLIENT_ID && e.SPREE_CLIENT_SECRET)
    return oauthClientCredentials.signIn(transport, {
      clientId: e.SPREE_CLIENT_ID,
      clientSecret: e.SPREE_CLIENT_SECRET,
    });
  if (e.SPREE_EMAIL && e.SPREE_PASSWORD) {
    const creds = { email: e.SPREE_EMAIL, password: e.SPREE_PASSWORD };
    return env.family === 'admin-v3'
      ? adminJwt.signIn(transport, creds)
      : oauthPasswordGrant.signIn(transport, creds);
  }
  throw new Error('Set SPREE_TOKEN, SPREE_API_KEY, SPREE_CLIENT_ID/SECRET or SPREE_EMAIL/PASSWORD');
}

export const baseTransport = () => createTransport({ baseUrl: env.url, timeoutMs: 30_000 });

/** capability → pass/fail, written to contract-results/<label>.json by the reporter. */
export const results: Record<string, 'pass' | 'fail'> = {};
