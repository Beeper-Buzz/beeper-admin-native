import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { env } from './env';

/**
 * Runs Ruby in the Docker store with `docker compose exec <service> bin/rails runner`, as
 * scripts/spree-up.mjs seeds it, for data the API can't create (demo inbox messages, visits,
 * taxonomies). Contract files that need it skip when it fails.
 */
const COMPOSE_FILE = resolve(__dirname, '../../../infra/spree/docker-compose.yml');
/** Docker Compose service for each contract label (scripts/spree-up.mjs). */
const SERVICE: Record<string, string> = { '4.2': 'spree42', '6.0': 'spree60' };

export function rails(script: string): { ok: boolean; out: string } {
  const service = SERVICE[env.label.split('-')[0] ?? ''];
  if (!service) return { ok: false, out: `no Docker service for Spree ${env.label}` };
  const res = spawnSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'exec', '-T', service, 'bin/rails', 'runner', script],
    { encoding: 'utf8', timeout: 180_000 },
  );
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/**
 * Runs Ruby whose last line prints `CT_JSON <json>` and returns that JSON, or a reason it failed.
 * `script` must end with an expression the helper prints.
 */
export function railsJson<T>(script: string): { value: T } | { error: string } {
  const res = rails(`__ct = begin; ${script}; end; puts "CT_JSON #{__ct.to_json}"`);
  const line = res.out.split('\n').find((l) => l.startsWith('CT_JSON '));
  if (!res.ok || !line) return { error: res.out.trim().split('\n').slice(-3).join(' ') || 'no output' };
  try {
    return { value: JSON.parse(line.slice('CT_JSON '.length)) as T };
  } catch {
    return { error: `unreadable output: ${line}` };
  }
}
