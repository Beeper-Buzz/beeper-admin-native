// Resolves `@distribution` to distributions/$APP_DISTRIBUTION (default: "default"). See docs/forking.md.
const path = require('node:path');
// Sentry's config is Expo's default plus debug IDs, which tie crash stack traces to source maps.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);
const distribution = process.env.APP_DISTRIBUTION || 'default';
const distributionEntry = path.resolve(__dirname, '../../distributions', distribution, 'index.ts');

const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@distribution') return { type: 'sourceFile', filePath: distributionEntry };
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
