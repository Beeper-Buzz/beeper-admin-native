# Forking guide: distributions

Spree Admin Native is built to be forked into branded apps. The rule that keeps forks cheap
to maintain is simple: **brand lives in one folder.**

## Layout

```
distributions/
  types.ts                    # DistributionConfig: every field a distribution can set
  default/                    # upstream app (only upstream edits this)
    distribution.json
    index.ts                  # theme and fonts, imported as @distribution
    theme.ts
  <your-brand>/               # your fork (only you edit this)
    distribution.json
    index.ts
    theme.ts
    assets/                   # icon, splash, Android foreground
```

`APP_DISTRIBUTION=<your-brand>` selects the folder: `app.config.ts` reads its
`distribution.json`, and Metro resolves `@distribution` to its `index.ts`. Set the same variable
on your EAS project (all environments) so cloud builds and `eas update` use it.

## `distribution.json`

```json
{
  "name": "Acme Admin",
  "slug": "acme-admin",
  "scheme": "acmeadmin",
  "version": "1.0.0",
  "ios": { "bundleIdentifier": "com.example.admin", "appleTeamId": "XXXXXXXXXX" },
  "android": { "package": "com.example.admin" },
  "eas": { "projectId": "00000000-0000-0000-0000-000000000000", "owner": "your-expo-account" },
  "assets": { "icon": "assets/icon.png", "splash": "assets/splash.png" },
  "defaultStoreUrl": "https://admin.example.com",
  "lockToStore": true,
  "brandColor": "#000000",
  "sentry": {
    "dsn": "https://<key>@<org>.ingest.sentry.io/<project-id>",
    "organization": "your-sentry-org",
    "project": "acme-admin"
  },
  "storeUrls": {
    "ios": "https://apps.apple.com/app/id0000000000",
    "android": "https://play.google.com/store/apps/details?id=com.example.admin"
  }
}
```

`distributions/types.ts` documents each field.

`storeUrls` (optional) are your app's own store listings. A Spree store with the companion gem
0.6 can require or recommend a minimum app version; when it sets no update link of its own, the
app's Update button opens the listing for the platform here, and without either the button is
hidden. The app reads `storeUrls` at runtime, so adding or changing them can ship as an update
(`eas update`) without a new build.

## Crash reporting (Sentry)

Off unless your distribution has a DSN. With one, release builds (never the dev server) send
crashes and errors, performance traces for screen loads and API calls (Expo Router
integration), and logs (console warnings and errors, and `Sentry.logger`). Events are tagged
with the EAS update channel as the environment and with the connected store's host and API
family. It sends no IP addresses,
cookies or request bodies, and filters credential headers (`Authorization`, `X-Spree-Token`,
`X-Spree-Api-Key`…) and token query parameters out of every event, breadcrumb and log.

| Setting | Where | Effect |
| --- | --- | --- |
| `sentry.dsn` | `distribution.json`, or `SENTRY_DSN` on the EAS project | Turns reporting on. The DSN is public by design; it ships in the app |
| `sentry.organization`, `sentry.project` | `distribution.json`, or `SENTRY_ORG` / `SENTRY_PROJECT` | Builds upload source maps and debug symbols, so stack traces show your code |
| `SENTRY_AUTH_TOKEN` | EAS project, visibility **Secret** | Authorizes those uploads. Never commit it |
| `sentry.tracesSampleRate` | `distribution.json` | Share of sessions that send performance traces (0–1). Default 0.1 |
| `sentry.logs` | `distribution.json` | `false` stops sending logs. Default on |

To check a new setup, add a temporary route that throws:

```tsx
// apps/mobile/src/app/sentry-test.tsx (remove after checking)
export default function SentryTest(): never {
  throw new Error(`Sentry test error ${Date.now()}`);
}
```

Open `<scheme>://sentry-test` on a release build, find the error in Sentry, then delete the file.
The app's error screen reports render errors, so nothing else is needed.

`eas.json` sets `SENTRY_ALLOW_FAILURE=true`, so a missing or expired auth token costs you
readable stack traces, not the build. Turning Sentry on changes your App Store privacy answers:
declare **Crash data** and **Performance data** as collected, not linked to the user, for app
functionality.

## Build

```sh
APP_DISTRIBUTION=acme pnpm --filter @instincts/spree-mobile start
cd apps/mobile && APP_DISTRIBUTION=acme eas build --profile production --platform ios
```

## Staying in sync

1. Fork on GitHub (keeps history), or add `upstream` as a remote.
2. Copy `.github/workflows/upstream-sync.yml` from the `beeper-admin-native` fork; it opens a
   weekly "Sync upstream" pull request.
3. Never edit files outside `distributions/<your-brand>/` and your fork's own docs. If you need
   a change elsewhere, upstream it.
