# 7. Storefront kit in this monorepo, without tRPC

- Status: Superseded by ADR 0009 (placement only; "no tRPC" still holds) · 2026-11-26

## Context
We want an `expo-spree` package any Expo app can add for a Spree shop. No version-agnostic
React Native kit exists: `@spree/sdk` covers only Store API v3 (Spree 5.4+), and the v2 SDK
has not been published since 2023. The admin app already needs the same transport, error
model, capability probe and domain models.

## Decision
- Build the storefront kit in this monorepo: `@spree-native/storefront` (framework-free client
  with `storefront-v2` and `store-v3` adapters) and `expo-spree` (provider, hooks, config plugin).
- Share `@spree-native/domain` and `@spree-native/spree-sdk` with the admin app.
- Do not use tRPC in the storefront kit; expose a plain client and TanStack Query hooks.

## Consequences
- Phase 0 packages must stay framework-free and free of admin-only assumptions.
- The repo name says "admin" but holds both; revisit the name before 1.0 if that confuses people.
