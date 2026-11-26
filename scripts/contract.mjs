#!/usr/bin/env node
// `pnpm contract --spree 4.2|6.0|all` starts the Docker store(s), reads their credentials from
// `spree-up.mjs --json` (never stored in the repo) and runs the contract suite once per sign-in method.
import { spawnSync } from 'node:child_process';

const i = process.argv.indexOf('--spree');
const wanted = i > -1 ? process.argv[i + 1] : 'all';

const up = spawnSync('node', ['scripts/spree-up.mjs', wanted, '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (up.status !== 0) process.exit(up.status ?? 1);
const stores = JSON.parse(up.stdout);

const ADMIN = { SPREE_EMAIL: 'admin@example.com', SPREE_PASSWORD: 'spree123' };
/** One run per sign-in method each version supports (infra/spree/FINDINGS.md). */
const runs = [];
for (const [version, s] of Object.entries(stores)) {
  const c = s.credentials ?? {};
  if (version === '4.2')
    runs.push({ label: '4.2', family: 'api-v1', env: { SPREE_TOKEN: c.SPREE42_ADMIN_API_KEY } });
  if (version === '6.0') {
    runs.push({ label: '6.0', family: 'admin-v3', env: { SPREE_API_KEY: c.SPREE60_SECRET_API_KEY } });
    runs.push({ label: '6.0-jwt', family: 'admin-v3', env: ADMIN });
  }
  for (const r of runs) r.url ??= s.baseUrl;
}

let failed = false;
for (const r of runs) {
  console.log(`\n▶ Spree ${r.label} (${r.family}) at ${r.url}`);
  const env = {
    ...process.env,
    SPREE_URL: r.url,
    SPREE_LABEL: r.label,
    SPREE_EXPECT_FAMILY: r.family,
    ...r.env,
  };
  const res = spawnSync('pnpm', ['--filter', '@instincts/spree-sdk', 'contract'], {
    stdio: 'inherit',
    env,
  });
  failed ||= res.status !== 0;
}
spawnSync('node', ['scripts/compat-matrix.mjs'], { stdio: 'inherit' });
process.exit(failed ? 1 : 0);
