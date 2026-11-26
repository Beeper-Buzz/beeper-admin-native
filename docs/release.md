# Releasing: Expo Go, Snack and npm

## Run the app in Expo Go (works today)

Everything the app uses ships in Expo Go for SDK 58 (router, Native Tabs, camera, secure
store, fonts, local notifications), so no development build is needed to try it.

```sh
pnpm install
node scripts/spree-up.mjs 4.2          # or point at a real store
pnpm --filter @spree-native/mobile start
```

Scan the QR code with Expo Go (SDK 58). The phone can't reach `localhost`: connect to the
store with your machine's LAN address (`http://192.168.x.x:3042`) or a public store.

What does **not** work in Expo Go:

| Feature | Why | Use instead |
| --- | --- | --- |
| Push notifications | Removed from Expo Go in SDK 53 | `eas build --profile development` (dev client is installed) |
| `APP_DISTRIBUTION` themes for forks | Works, but the fork's fonts must be bundled | Same, nothing extra |

## Snack

Snack runs a single project from npm packages; it can't use this pnpm workspace, the
`@distribution` Metro alias or packages that only exist in git. So a Snack needs:

1. The shared packages on npm (below), built to JavaScript.
2. A Snack-sized entry: the **expo-spree example** is the natural first Snack (one screen tree,
   `expo-spree` from npm, a public demo store). The admin app is better shown as an Expo Go
   QR from `eas update` than as a Snack.
3. A public demo store reachable from snack.expo.dev, with CORS allowing the Snack web
   preview (Spree 4.2 sends no CORS headers; device previews in Expo Go don't need CORS).

## Publish to npm

| Package | Repo | Scope to claim on npm |
| --- | --- | --- |
| `@spree-native/domain` | spree-admin-native | `@spree-native` (org) |
| `@spree-native/spree-sdk` | spree-admin-native | `@spree-native` |
| `@spree-native/ui` | spree-admin-native | `@spree-native` |
| `@expo-spree/storefront` | expo-spree | `@expo-spree` (org) |
| `expo-spree` | expo-spree | unscoped (name free as of 2026-11-26) |

Needed, in order:

1. **npm orgs** `@spree-native` and `@expo-spree`, and an automation token with publish rights,
   saved as the `NPM_TOKEN` secret in both GitHub repos.
2. **Build step.** The packages export TypeScript source today (fine inside the monorepos).
   For npm they need `dist/` builds (ESM + CJS + `.d.ts`, e.g. tsup) and `publishConfig`
   pointing at them, with `"access": "public"` and provenance.
3. **Versions and changelogs** with Changesets (already a dev dependency): a release workflow
   that opens a "Version packages" PR and publishes on merge. GitHub immutable releases are
   fine with this; tags are never moved.
4. **expo-spree** switches its `vendor/spree-admin-native` submodule for the published
   `@spree-native/*` versions (ADR 0002 in that repo).
5. **A `main` branch** in each repo for releases to come from (today the work is on
   `claude/admin-native-apps-planning-s43gki`).

## Ship the app (any distribution)

`apps/mobile/eas.json` has `development`, `preview` and `production` profiles. Each
distribution sets its own Expo project in `distributions/<name>/distribution.json`
(`eas.projectId`, `eas.owner`), so builds pick it with:

```sh
cd apps/mobile
APP_DISTRIBUTION=<name> npx eas-cli build --profile production --platform ios
APP_DISTRIBUTION=<name> npx eas-cli submit --profile production --platform ios
```

Set `APP_DISTRIBUTION` as an environment variable in that EAS project too, so cloud builds and
`eas update` use the same distribution.
