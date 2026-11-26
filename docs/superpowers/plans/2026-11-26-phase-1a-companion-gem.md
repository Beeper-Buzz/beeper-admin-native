# Phase 1a: Companion gem (pairing, devices, push, summary) — Implementation Plan

> Execute task by task. Commit format: `[Type]: Title. Changes:` with `1.` list items.

**Goal:** `spree_admin_native` v0.1, a Rails engine any Spree store can add, that lets an admin pair
the app by scanning a QR code instead of pasting an API key, sends a push notification for every
new order, and serves the Home screen's numbers in one request. Proven on the Docker Spree 4.2
store; the app gains "Scan pairing code".

**Why first:** on Spree 4.2–4.3 the only other sign-in is pasting an API key (infra/spree/FINDINGS.md),
and Beeper's store is 4.2.5.

## Design

| Piece | Behaviour |
| --- | --- |
| `GET /api/admin_native/v1/capabilities` | Public. Spree version, gem version, API families present, extra capabilities (`notifications.push`, `analytics.summary`, extension ones such as `beeper.moderation`), extra sign-in methods (`pairing` where the Rails admin exists), store name and currency. The app merges these with its own per-family defaults. |
| Pairing | Admin opens **/admin/admin_native/devices** (Spree 4.x/5.x Rails admin), taps **Pair a device**, sees a QR and a 12-character code valid for 10 minutes, single use, stored as a SHA-256 digest. Headless alternative: `bin/rails "spree_admin_native:pairing_code[admin@example.com]"`. |
| Exchange | `POST /api/admin_native/v1/pairings/exchange {code, device_name, platform}` → `{token: "san_…", device, user}`. The token is stored as a digest, revocable per device. |
| Device tokens on API v1 | The gem prepends `Spree::Api::BaseController#load_user` so a `san_…` device token in `X-Spree-Token` authenticates as its admin. The app reuses its existing `spreeToken` credential, so every v1 endpoint works with no new auth code. |
| Devices API | `GET /devices`, `PATCH /devices/current {push_token, push_enabled}`, `DELETE /devices/:id` (device-token auth). |
| Push | `after_commit` on `Spree::Order` when `completed_at` becomes set → `PushJob` → Expo Push API (`SPREE_ADMIN_NATIVE_EXPO_PUSH_URL` overridable for tests). |
| Summary | `GET /api/admin_native/v1/summary`: today's sales and order count in the store's time zone and currency, orders to fulfil, payments due, low-stock variants, computed in SQL. |

Scope limits for v0.1: Spree 4.x proven in Docker; Spree 6 has no Rails admin (no pairing) and is
not yet in the gem's matrix. Platform v2 device tokens (Doorkeeper) come later.

## Tasks

- [x] **T1 Engine skeleton**: gemspec (Ruby ≥ 2.7, spree_core ≥ 4.2, rqrcode), engine, migrations
      auto-appended to the host app, config (`register_capability`).
- [x] **T2 Docker**: build the 4.2 image with the gem from `gems/` (compose `additional_contexts`),
      mount it for live edits.
- [x] **T3 Capabilities endpoint** + TS probe merges gem extras with family defaults.
- [x] **T4 Pairing + exchange + device-token auth on API v1**, with the rake task.
- [x] **T5 Admin devices page** with QR, list and revoke.
- [x] **T6 Devices API, push on new orders, summary endpoint.**
- [x] **T7 Tests**: Ruby integration test run inside the container (pairing, auth, revoke, push
      delivery to a local capture server, summary); TS contract tests through the gem.
- [x] **T8 App**: "Scan pairing code" (expo-camera) and manual code entry, `store.pair` procedure,
      Home uses `summary` when the store has `analytics.summary`.

## Result (2026-11-26)

- Gem integration test: 10 runs, 43 assertions, green inside the Spree 4.2 Docker app.
- Contract: pairing run 10/10 on 4.2 (`auth.pairing`, `analytics.summary` now in `docs/compatibility.md`).
- Migrations follow Spree convention (`railties:install:migrations`); auto-appending the path
  collided with apps that already run that task.
- Not yet: Spree 6 (no Rails admin for pairing), Platform v2 device tokens, a real device push
  (needs an EAS project ID in a distribution).
