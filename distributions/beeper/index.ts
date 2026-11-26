import type { DistributionConfig, FontAssets } from '../types';
import config from './distribution.json';

export const distribution: DistributionConfig = config;
export { theme } from './theme';

// Single weights by file; see FontAssets in ../types.ts.
export const fontAssets: FontAssets = {
  PressStart2P_400Regular: require('@expo-google-fonts/press-start-2p/400Regular/PressStart2P_400Regular.ttf'),
  Barlow_500Medium: require('@expo-google-fonts/barlow/500Medium/Barlow_500Medium.ttf'),
  IBMPlexMono_400Regular: require('@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf'),
};
