import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'vitest';
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

export type Outcome = 'pass' | 'fail';

/** capability → pass/fail for this file; `writeResults` merges it into contract-results/<label>.json. */
export const results: Record<string, Outcome> = {};

/** Wrap a test so its outcome is recorded against a capability. A failure anywhere wins. */
export function proves(
  capability: string,
  name: string,
  fn: (skip: (why: string) => never) => Promise<void>,
): void {
  it(`[${capability}] ${name}`, async (ctx) => {
    // ctx.skip() works by throwing; a skipped test proves nothing either way.
    let skipped = false;
    try {
      await fn((why) => {
        skipped = true;
        return ctx.skip(why) as never;
      });
      if (results[capability] !== 'fail') results[capability] = 'pass';
    } catch (e) {
      if (!skipped) results[capability] = 'fail';
      throw e;
    }
  });
}

const resultsDir = resolve(__dirname, '../../../contract-results');
const resultsFile = () => resolve(resultsDir, `${env.label}.json`);

/**
 * Merge this file's results into contract-results/<label>.json. Every contract file calls this in
 * afterAll; files run one after another (fileParallelism: false), each in its own module scope,
 * and contract/setup.ts empties the file when a run starts.
 */
export function writeResults(): void {
  mkdirSync(resultsDir, { recursive: true });
  const file = resultsFile();
  const previous: Record<string, Outcome> = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')).results ?? {})
    : {};
  const merged: Record<string, Outcome> = { ...previous };
  for (const [capability, outcome] of Object.entries(results)) {
    if (merged[capability] !== 'fail') merged[capability] = outcome;
  }
  writeFileSync(
    file,
    `${JSON.stringify({ label: env.label, family: env.family, results: merged }, null, 2)}\n`,
  );
}
