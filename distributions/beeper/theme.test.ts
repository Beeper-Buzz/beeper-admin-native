import { contrastFailures } from '@spree-native/ui';
import { describe, expect, it } from 'vitest';
import { theme } from './theme';

describe('Beeper theme', () => {
  it('passes the upstream contrast checks in both schemes', () => {
    expect(contrastFailures(theme.dark)).toEqual([]);
    expect(contrastFailures(theme.light)).toEqual([]);
  });
});
