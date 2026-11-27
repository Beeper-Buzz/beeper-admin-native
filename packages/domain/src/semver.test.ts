import { describe, expect, it } from 'vitest';
import { coerceVersion, compareVersions, isBelow } from './semver';

describe('coerceVersion', () => {
  it('fills in missing parts', () => {
    expect(coerceVersion('1')).toEqual([1, 0, 0]);
    expect(coerceVersion('1.2')).toEqual([1, 2, 0]);
    expect(coerceVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  it('drops prerelease and build tags', () => {
    expect(coerceVersion('1.2.0-beta.1')).toEqual([1, 2, 0]);
    expect(coerceVersion('1.2-rc1')).toEqual([1, 2, 0]);
    expect(coerceVersion('1.2.0+42')).toEqual([1, 2, 0]);
    expect(coerceVersion(' 1.10.0 ')).toEqual([1, 10, 0]);
  });

  it('reads only what the companion gem reads', () => {
    expect(coerceVersion('v1.0.0')).toBeNull();
    expect(coerceVersion('1.2.3.4')).toBeNull();
    expect(coerceVersion('1.2.0beta')).toBeNull();
    expect(coerceVersion('1..2')).toBeNull();
    expect(coerceVersion('1.2.0-beta_1')).toBeNull();
    expect(coerceVersion('')).toBeNull();
    expect(coerceVersion('beta')).toBeNull();
    expect(coerceVersion(null)).toBeNull();
    expect(coerceVersion(undefined)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('compares numerically, part by part', () => {
    expect(compareVersions([1, 10, 0], [1, 9, 9])).toBe(1);
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compareVersions([0, 9, 0], [1, 0, 0])).toBe(-1);
  });
});

describe('isBelow', () => {
  it('is true only when the installed version is lower', () => {
    expect(isBelow('1.0.0', '1.1.0')).toBe(true);
    expect(isBelow('1.1.0', '1.1.0')).toBe(false);
    expect(isBelow('1.2.0', '1.1.0')).toBe(false);
    expect(isBelow('1.9.0', '1.10.0')).toBe(true);
  });

  it('treats 1.2 as 1.2.0 and ignores prerelease tags', () => {
    expect(isBelow('1.2', '1.2.0')).toBe(false);
    expect(isBelow('1.2.0-beta.1', '1.2.0')).toBe(false);
    expect(isBelow('1.1.9', '1.2')).toBe(true);
  });

  it('fails open on anything missing or unreadable', () => {
    expect(isBelow(null, '1.0.0')).toBe(false);
    expect(isBelow('1.0.0', null)).toBe(false);
    expect(isBelow('1.0.0', '')).toBe(false);
    expect(isBelow('unknown', '2.0.0')).toBe(false);
    expect(isBelow('1.0.0', 'latest')).toBe(false);
    expect(isBelow('v0.9.0', '1.0.0')).toBe(false);
    expect(isBelow('1.0.0.1', '2.0.0')).toBe(false);
  });

  it('reads a minimum of 0.0.0 as none', () => {
    expect(isBelow('0.0.0', '0.0.0')).toBe(false);
    expect(isBelow('0.0.0', '0.0')).toBe(false);
  });
});
