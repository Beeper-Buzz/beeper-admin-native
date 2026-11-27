import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Vitest globalSetup: runs once per `pnpm contract`, before any contract file, and drops this
 * label's results from an earlier run so each file's `writeResults` merges into a fresh file.
 */
export default function setup(): void {
  if (!process.env.SPREE_URL) return;
  const label = process.env.SPREE_LABEL ?? 'unknown';
  rmSync(resolve(__dirname, '../../../contract-results', `${label}.json`), { force: true });
}
