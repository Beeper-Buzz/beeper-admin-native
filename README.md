# Beeper Admin

The admin app for the [Beeper](https://beeper.buzz) store and community, on iOS and Android.

A fork of the open-source [Spree Admin Native](https://github.com/1instinct/spree-admin-native)
Spree admin app, with Beeper's brand and native extensions for moderation, support,
in-app purchases, live streams and content.

> Status: **planning**. See the [fork spec](docs/superpowers/specs/2026-11-26-beeper-admin-native-design.md)
> and the [Beeper plan](docs/superpowers/plans/2026-11-26-beeper-fork-setup.md).
> The upstream spec is in `docs/superpowers/specs/2026-11-26-spree-admin-native-design.md`.

## Fork rules

- Beeper-only code lives in `distributions/beeper/` and `docs/beeper/`.
- Everything else comes from upstream. Generic fixes go upstream first.
- A weekly workflow opens a **Sync upstream** pull request.

## Build

```sh
APP_DISTRIBUTION=beeper pnpm --filter mobile start
APP_DISTRIBUTION=beeper eas build --profile production
```

## Backend

The store backend is [`dna-admin`](https://github.com/1instinct/dna-admin) (Spree 4.2.5),
served at `admin.beeper.buzz`.
