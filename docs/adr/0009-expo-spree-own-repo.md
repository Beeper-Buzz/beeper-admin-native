# 9. expo-spree moves to its own repo

- Status: Accepted · 2026-11-26 · Supersedes ADR 0007 (placement)

## Decision
The storefront kit lives in [`1instinct/expo-spree`](https://github.com/1instinct/expo-spree).
This repo keeps owning the shared `@spree-native/domain` and `@spree-native/spree-sdk` packages
and the Docker Spree matrix; expo-spree depends on them (git dependencies until they are on npm)
and its CI reuses `scripts/spree-up.mjs`. The storefront kit still does not use tRPC.

## Consequences
- `domain` and `spree-sdk` stay framework-free and free of admin-only assumptions.
- Publishing both packages to npm is now on the Phase 1 list.
- Storefront models the kit needs (taxons, option types, images) are added here first.
