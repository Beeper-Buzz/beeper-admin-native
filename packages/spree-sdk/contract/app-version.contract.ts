import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isBelow } from '@instincts/spree-domain';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { probeStore } from '../src/capabilities/probe';
import type { StoreProbe } from '../src/capabilities/types';
import { companion } from '../src/companion';
import { baseTransport, enabled, env, proves, writeResults } from './env';

/**
 * The app version gate (companion gem 0.6, docs/superpowers/specs/2026-11-28-app-version-gate.md)
 * against a live store. Skips without `app.versionGate`.
 *
 * Versions are set only in Spree's HTML admin, so the API can't set them. The endpoint's shape is
 * proven with nothing set; a set gate is proven too when the Docker store's database can be
 * reached with `docker compose exec <service> bin/rails runner` (as scripts/spree-up.mjs seeds it),
 * on the `android` row only when the store has none (with allow_ahead_of_store), and that row is
 * deleted again.
 */
const PATH = '/api/admin_native/v1/app_version';
const COMPOSE_FILE = resolve(__dirname, '../../../infra/spree/docker-compose.yml');
/** Docker Compose service for each contract label (scripts/spree-up.mjs). */
const SERVICE: Record<string, string> = { '4.2': 'spree42', '6.0': 'spree60' };
const UPDATE_URL = 'https://play.google.com/store/apps/details?id=com.example.admin';

interface Body {
  data: {
    minimum_version: string | null;
    recommended_version: string | null;
    update_url: string | null;
    update_required: boolean;
    update_recommended: boolean;
  };
}

function rails(script: string): { ok: boolean; out: string } {
  const service = SERVICE[env.label.split('-')[0] ?? ''];
  if (!service) return { ok: false, out: `no Docker service for Spree ${env.label}` };
  const res = spawnSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'exec', '-T', service, 'bin/rails', 'runner', script],
    { encoding: 'utf8', timeout: 120_000 },
  );
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

describe.runIf(enabled)(`app version contract: Spree ${env.label}`, () => {
  let probe: StoreProbe;
  const api = baseTransport();
  /** Whether this run created the android row, and so must delete it. */
  let seeded = false;
  let seedSkip: string | null = null;

  const get = async (query: Record<string, string>) => {
    const res = await api.request<Body>({ path: PATH, query, auth: 'none' });
    expect(res.status).toBe(200);
    return res.data;
  };

  beforeAll(async () => {
    probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
  });

  afterAll(() => {
    if (seeded) {
      rails(
        `SpreeAdminNative::AppVersion.where(platform: 'android', update_url: '${UPDATE_URL}').delete_all`,
      );
    }
    writeResults();
  });

  const gated = (skip: (why: string) => never) => {
    if (!probe.capabilities.includes('app.versionGate'))
      skip('no app.versionGate (needs the companion gem 0.6)');
  };

  proves(
    'app.versionGate',
    'answers without auth, with nulls and false when nothing is set',
    async (skip) => {
      gated(skip);
      for (const platform of ['ios', 'android']) {
        const body = await get({ platform, version: '1.0.0' });
        expect(body).toEqual({
          data: {
            minimum_version: null,
            recommended_version: null,
            update_url: null,
            update_required: false,
            update_recommended: false,
          },
        });
      }
      // No version, or one that doesn't parse: the booleans stay false and the app compares itself.
      expect((await get({ platform: 'ios' })).data.update_required).toBe(false);
      expect((await get({ platform: 'ios', version: 'not-a-version' })).data.update_required).toBe(false);
      // The SDK reads the same answer.
      expect(await companion(api).appVersion('ios', '1.0.0')).toEqual({
        minimumVersion: null,
        recommendedVersion: null,
        updateUrl: null,
        updateRequired: false,
        updateRecommended: false,
      });
    },
  );

  proves('app.versionGate', 'a set gate applies to its platform only', async (skip) => {
    gated(skip);
    const seed = rails(
      [
        "if SpreeAdminNative::AppVersion.exists?(platform: 'android') then puts 'CT_EXISTS' else",
        `SpreeAdminNative::AppVersion.create!(platform: 'android', minimum_version: '1.0.0', recommended_version: '1.1.0', update_url: '${UPDATE_URL}', allow_ahead_of_store: true);`,
        "puts 'CT_CREATED' end",
      ].join(' '),
    );
    if (seed.out.includes('CT_EXISTS')) seedSkip = 'the store already has an android row';
    else if (!seed.ok || !seed.out.includes('CT_CREATED'))
      seedSkip = `can't seed through docker compose exec: ${seed.out.trim().split('\n').pop()}`;
    else seeded = true;
    if (seedSkip) skip(seedSkip);

    // Below the minimum both booleans are true; the app shows Update required.
    const below = await get({ platform: 'android', version: '0.9.0' });
    expect(below.data).toEqual({
      minimum_version: '1.0.0',
      recommended_version: '1.1.0',
      update_url: UPDATE_URL,
      update_required: true,
      update_recommended: true,
    });
    const between = await get({ platform: 'android', version: '1.0.5' });
    expect(between.data).toMatchObject({ update_required: false, update_recommended: true });
    const current = await get({ platform: 'android', version: '1.1.0' });
    expect(current.data).toMatchObject({ update_required: false, update_recommended: false });
    // No version sent: the settings, but no verdict.
    expect((await get({ platform: 'android' })).data).toMatchObject({
      minimum_version: '1.0.0',
      update_required: false,
    });
    // The app's own compare (packages/domain semver) agrees with the store's on every input,
    // including the ones neither side parses.
    for (const version of [
      '0.9',
      '0.9.9-beta.1',
      '1.0',
      '1.0.0+7',
      '1.0.9',
      '1.1',
      'v0.9.0',
      '0.9.0.1',
      'x',
    ]) {
      const { data } = await get({ platform: 'android', version });
      expect({ version, required: data.update_required, recommended: data.update_recommended }).toEqual({
        version,
        required: isBelow(version, '1.0.0'),
        recommended: isBelow(version, '1.1.0'),
      });
    }
    // Another platform has its own settings (none here, and no `all` row).
    expect((await get({ platform: 'ios', version: '0.9.0' })).data.minimum_version).toBeNull();
    expect(await companion(api).appVersion('android', '0.9.0')).toMatchObject({
      minimumVersion: '1.0.0',
      updateUrl: UPDATE_URL,
      updateRequired: true,
      updateRecommended: true,
    });

    // A 0.0.0 minimum comes back as the string and never requires an update.
    const lowered = rails(
      `SpreeAdminNative::AppVersion.find_by!(platform: 'android', update_url: '${UPDATE_URL}').update!(minimum_version: '0.0.0'); puts 'CT_LOWERED'`,
    );
    expect(lowered.out).toContain('CT_LOWERED');
    expect((await get({ platform: 'android', version: '0.0.0' })).data).toMatchObject({
      minimum_version: '0.0.0',
      update_required: false,
      update_recommended: true,
    });
  });
});
