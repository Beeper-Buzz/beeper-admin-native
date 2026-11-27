/**
 * A small semantic-version compare for the app version gate (docs/superpowers/specs/
 * 2026-11-28-app-version-gate.md). Versions are coerced to `major.minor.patch`: `1.2` reads as
 * `1.2.0`, and a prerelease or build tag (`1.2.0-beta.1`, `1.2.0+9`) is dropped. It reads exactly
 * what the companion gem (0.6) reads, so the app and the store never disagree: `v1.0.0`,
 * `1.2.3.4` and anything else that isn't one to three dot-separated numbers doesn't parse.
 */
export type SemVer = readonly [major: number, minor: number, patch: number];

/** `1.2` → [1, 2, 0]; null for anything the gem wouldn't parse either. */
export function coerceVersion(value: string | null | undefined): SemVer | null {
  if (typeof value !== 'string') return null;
  // The gem's INSTALLED_FORMAT (SpreeAdminNative::AppVersion), tag characters included.
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.+-]*)?$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** -1, 0 or 1, like a sort comparator. */
export function compareVersions(a: SemVer, b: SemVer): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Whether `installed` is below `target`. Fails open: false when either is missing or can't be
 * read, and for a target of `0.0.0` (the gem's "no minimum").
 */
export function isBelow(installed: string | null | undefined, target: string | null | undefined): boolean {
  const a = coerceVersion(installed);
  const b = coerceVersion(target);
  if (!a || !b) return false;
  if (compareVersions(b, [0, 0, 0]) === 0) return false;
  return compareVersions(a, b) < 0;
}
