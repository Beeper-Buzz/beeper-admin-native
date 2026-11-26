# Forking guide: distributions

Spree Admin Native is built to be forked into branded apps. The rule that keeps forks cheap
to maintain is simple: **brand lives in one folder.**

## Layout

```
distributions/
  default/                    # upstream app (only upstream edits this)
    distribution.config.ts
    theme.ts
    assets/  icon.png  splash.png  adaptive-icon.png  sounds/till.caf
  <your-brand>/               # your fork (only you edit this)
    distribution.config.ts
    theme.ts
    assets/
    extensions/               # native extensions only your build ships
```

## `distribution.config.ts`

```ts
import { defineDistribution } from '@instincts/spree-extension-sdk/distribution';

export default defineDistribution({
  name: 'Acme Admin',
  slug: 'acme-admin',
  scheme: 'acmeadmin',
  ios: { bundleIdentifier: 'com.acme.admin', appleTeamId: 'XXXXXXXXXX' },
  android: { package: 'com.acme.admin' },
  eas: { projectId: '00000000-0000-0000-0000-000000000000', updatesChannel: 'production' },
  defaultStoreUrl: 'https://admin.acme.com',   // pre-fills Connect; omit for multi-store
  lockToStore: false,                          // true hides "add another store"
  extensions: ['@instincts/spree-ext-analytics', './extensions/acme-loyalty'],
  features: { marketplace: false, relay: false },
  telemetry: { sentryDsn: process.env.SENTRY_DSN },
});
```

## Build

```sh
APP_DISTRIBUTION=acme pnpm --filter mobile start
APP_DISTRIBUTION=acme eas build --profile production
```

## Staying in sync

1. Fork on GitHub (keeps history), or add `upstream` as a remote.
2. Copy `.github/workflows/upstream-sync.yml` from the `beeper-admin-native` fork; it opens a
   weekly "Sync upstream" pull request.
3. Never edit files outside `distributions/<your-brand>/`, `extensions/` and your fork's own
   docs. If you need a change elsewhere, upstream it.
