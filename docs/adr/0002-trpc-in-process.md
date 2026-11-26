# 2. tRPC router runs in the app by default

- Status: Accepted · 2026-11-26

## Context
Spree is a Rails app; tRPC is a TypeScript framework. We want typed end-to-end contracts,
TanStack Query integration, and zero extra servers for store owners.

## Decision
The app's `appRouter` (`@instincts/spree-api`) runs inside the app through tRPC's local link.
The same router can be served by the optional Relay over HTTP. Screens call tRPC only; they
never call Spree directly.

## Consequences
- One contract for UI, tests, Relay and extensions.
- The router bundle ships in the app (size budget: under 150 KB minified for `api` + `spree-sdk`).
- If `localLink` is unsuitable under Hermes, we maintain a small custom link.
