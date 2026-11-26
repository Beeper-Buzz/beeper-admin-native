# Beeper Admin Native — Fork Design Spec

- **Status:** Draft for review
- **Date:** 2026-11-26
- **Upstream:** `spree-admin-native` (see `docs/superpowers/specs/2026-11-26-spree-admin-native-design.md`)
- **Store backend:** `admin.beeper.buzz` — `dna-admin` (Spree 4.2.5 fork `1instinct/spree@instinct-4.2.5`)

## 1. Purpose

The private admin app for the Beeper store and community. It is the upstream app plus:

1. Beeper's brand (dark-first, magenta, device-inspired type).
2. Locked to the Beeper store (no "add another store").
3. Native extensions for everything `dna-admin` adds on top of Spree: content moderation,
   support inbox, in-app purchases and entitlements, live streams, homepage content,
   app feedback, loyalty points and referrals.

It is also upstream's **reference fork**: it proves the distribution contract, and it is
the first real Spree 4.2 store the app runs against every day.

## 2. Fork contract

- This repo is a GitHub fork of `spree-admin-native` and keeps its history.
- Beeper-only changes live in `distributions/beeper/`, `docs/beeper/` and this spec.
- Generic improvements found while building Beeper features go upstream first, then come
  back through the weekly **Sync upstream** pull request (`.github/workflows/upstream-sync.yml`).
- Build with `APP_DISTRIBUTION=beeper`.

## 3. Distribution config

| Key | Value |
| --- | --- |
| Name | Beeper Admin |
| Scheme | `beeperadmin` |
| iOS bundle / Android package | `buzz.beeper.admin` (confirm) |
| EAS project | New project under the Beeper Expo account |
| Default store | `https://admin.beeper.buzz` |
| `lockToStore` | `true` |
| Sign-in | Admin API key (`X-Spree-Token`) until the companion gem adds QR pairing; dna-admin is Spree 4.2.5, the `api-v1` family |
| Marketplace | Off (built-in and Beeper extensions only) |
| Telemetry | Sentry on (Beeper DSN), matching BeeperNative |

## 4. Theme (token overrides only)

Derived from BeeperNative `tailwind.config.js` / `src/styles/ThemeObject.ts`.

| Token | Value | Source |
| --- | --- | --- |
| `bg` | `#000000` | `surface.primary` |
| `surface` | `#111111` | `surface.secondary` |
| `surface-sunk` | `#1A1A1A` | `surface.card` |
| `ink` | `#F1F0E8` | `white.primary` |
| `ink-muted` | `#999999` | `gray.light` |
| `line` | `#333333` | `gray.dark` |
| `accent` (money-in) | `#FF008A` | `accent` (hot pink) |
| `on-accent` | `#FFFFFF` | |
| `accent-ink` | `#FF69B4` | `pink.light` |
| `positive` | `#33FF66` | device `led` |
| `attention` | `#FFB400` | `yellow` |
| `critical` | `#FF5252` | `error` |
| `info` | `#55C1FF` | `teal` |

Type: display **Press Start 2P** (money figures only, it is loud), UI **Barlow**, mono
**IBM Plex Mono**. All already bundled in BeeperNative via `@expo-google-fonts`.

Signature swap: the upstream till chime becomes a short Δ8 synth blip rendered from the
BeeperNative JUCE engine. Light theme: offered but secondary.

## 5. Beeper native extensions

Each lives in `distributions/beeper/extensions/<name>` and uses `@instincts/spree-extension-sdk`.

| Extension | Slots | dna-admin source today | Push |
| --- | --- | --- | --- |
| **Moderation** | Tab-level route, `home.cards` (open reports) | `Admin::ContentReportsController` (dismiss, hide profile, remove photo, clear bio, lock account), `UserProfilesController` (hide/unhide), `AccountLocksController` | New report |
| **Support inbox** | Route, `customer.detail.sections` | `Admin::MessagesController`, `ThreadsController`, message support; Pusher realtime | New message (realtime via Pusher while open) |
| **In-app purchases** | Route, `customer.detail.sections` (entitlements) | `Admin::IapTransactionsController` (revoke), `IapProductsController`, `EntitlementsController` (revoke), Apple/Google notification webhooks | Refund / revocation from Apple or Google |
| **Live** | Route, `home.cards` (live now) | `Admin::LiveStreamController` (generate playback), `/api/v1/live_stream` (watchers), live stream products | Stream started / ended |
| **Content** | `more.items` | `HomepageSectionsController` (move up/down), `ContentAssetsController`, menu locations/items | — |
| **Feedback** | `more.items`, `home.cards` | `AppFeedbacksController` | New feedback (optional) |
| **Loyalty & referrals** | `customer.detail.sections` | `spree_loyalty_points`, `spree_reffiliate` | — |
| **Product videos** | `product.detail.sections` | `ProductVideosController` (update positions) | — |

## 6. Backend work in `dna-admin`

Most of the above are HTML admin controllers today. The app needs JSON:

1. Add `spree_admin_native` (upstream gem) to `dna-admin`'s Gemfile: capabilities, device
   registration, push on order complete, pairing, summary.
2. Add `Spree::Api::V1::Beeper::*` controllers on `Spree::Api::BaseController` (API v1 auth:
   the admin's `X-Spree-Token`). Spree 4.2 has no Platform API, so Platform controllers are not
   an option (upstream `infra/spree/FINDINGS.md`). Reuse existing services
   (`EntitlementResolver`, `Iap`, `AccountDeletion`, `Profiles`).
3. Publish them as capabilities from the gem's capabilities endpoint
   (`beeper.moderation`, `beeper.iap`, `beeper.live`, …) so extensions gate cleanly.
4. Fire push events from existing hooks: new `ContentReport`, new support `Message`,
   Apple/Google IAP notifications, live stream state changes.
5. Request specs for each endpoint; Swagger docs alongside the existing `apidocs`.

## 7. Roadmap (tracks upstream phases)

| When | Beeper scope |
| --- | --- |
| Upstream Phase 0 | dna-admin is the 4.2 reference store; record fixtures from a staging copy |
| Upstream Phase 1 | Fork builds with Beeper theme; orders + push live for the Beeper team on TestFlight |
| +2 weeks | Moderation and Support inbox extensions (highest daily value on mobile) |
| +4 weeks | IAP & entitlements, Live |
| Upstream Phase 2 | Content, Feedback, Loyalty, Product videos |

## 8. Open questions

1. Bundle identifier and Expo account for the Beeper build.
2. Which staff accounts get moderation powers vs order-only access (map to Spree roles).
3. Should support chat use Pusher on mobile too (consistent with dna-admin) or polling + push?
4. Is a light theme wanted at all for Beeper?
