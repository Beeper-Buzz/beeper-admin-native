import { counterTheme } from '@instincts/spree-ui';
import type { DistributionConfig, FontAssets } from '../types';
import config from './distribution.json';

export const distribution: DistributionConfig = config;
export const theme = counterTheme;
/** Extra fonts the theme names (the app always loads "The Counter" fonts). */
export const fontAssets: FontAssets = {};
