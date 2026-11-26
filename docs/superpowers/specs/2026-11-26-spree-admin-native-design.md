# Spree Admin Native — Design Spec

- **Status:** Draft for review
- **Date:** 2026-11-26
- **Repo:** [`1instinct/spree-admin-native`](https://github.com/1instinct/spree-admin-native) (open source, MIT, template repo, immutable releases)
- **First fork:** `beeper-admin-native` (see its own spec)

## 1. What we are building

A native admin app for **Spree Commerce** stores, for iOS, Android, iPad and the web, that
gives a store owner the "Shopify app" experience: a push notification the moment an order
lands, a home screen that says what needs doing today, and the ability to fulfil, refund,
edit products, adjust stock and change store settings from a phone.

It must work against **any Spree from 4.2 to the latest release** without the store owner
running anything new. Extra features light up when the store has newer Spree or installs our
optional companion pieces.

### Who it is for

| Person | Job to be done |
| --- | --- |
| Solo owner / small team | "Tell me when I make a sale, let me ship it from the warehouse floor." |
| Ops / fulfilment staff | "Show me the unfulfilled queue, scan, pack, mark shipped." |
| Agency / dev shop | "Give my Spree clients a branded mobile admin without building one." (forks) |
| Spree extension authors | "Put my extension's actions in front of merchants on mobile." (extensions) |

### Non-goals (v1)

- Replacing the Spree web admin for every edge case (bulk CSV import, theme editing, page builder).
- A storefront / POS app (possible later extension, out of scope here).
- Supporting Spree < 4.2 (no Platform API).
- A hosted SaaS. Everything is self-hostable; the app works with no server of ours at all.

## 2. Principles

1. **Zero-server onboarding.** Type your store URL, sign in, done. No relay, no gem required
   for the core experience.
2. **Capabilities, not version numbers.** The app asks the store what it can do and adapts.
   It never branches on `if (version < 5)` in UI code.
3. **Compatibility is generated, not written.** The compatibility matrix in the README is the
   output of contract tests run against real Spree versions in CI, not a hand-kept table.
4. **One typed contract.** Every screen talks to one tRPC router. The router talks to Spree
   through version adapters. UI code never sees a Spree payload.
5. **Forkable by design.** Brand, theme, bundle IDs and the extension set live in one
   distribution folder. Forks merge upstream without conflicts.
6. **Private by default.** Store credentials never leave the device unless the owner turns on
   a relay. No analytics unless a distribution opts in.

## 3. Architecture

```
┌────────────────────────── apps/mobile (Expo SDK 58, Expo Router) ──────────────────────────┐
│ Screens ── @instincts/spree-ui (tokens, primitives, commerce patterns)                           │
│    │                                                                                        │
│ @trpc/tanstack-react-query  ── TanStack Query cache (persisted to MMKV)                    │
│    │                                                                                        │
│ tRPC link chain:  splitLink ─┬─ localLink  → appRouter runs IN the app (default)           │
│                              └─ httpBatchStreamLink → Relay (optional, self-hosted)        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                 │ appRouter (@instincts/spree-api)  — procedures + capability middleware
                 ▼
        @instincts/spree-sdk — transport · auth strategies · capability probe · adapters
          ├─ adapter: api-v1        (Spree 4.2 → 4.3)                  X-Spree-Token
          ├─ adapter: platform-v2   (Spree 4.4 → 5.x)                  OAuth2 bearer (app-bound)
          └─ adapter: admin-v3      (Spree 5.4 → 6.x)                  admin JWT or secret API key
                 │
                 ▼
            Spree store  (+ optional gem: spree_admin_native)
```

### 3.1 Why tRPC when the backend is Rails

Spree is Ruby; tRPC is TypeScript. We use tRPC as the **app's internal contract** and run the
router **inside the app** through tRPC's local link (`localLink` in `@trpc/client`
v11; Phase 0 spike confirms it in React Native, fallback is a 40-line custom link). This gives us:

- End-to-end types from domain schema to screen, with zod validation at the boundary.
- TanStack Query integration (cache keys, optimistic updates, offline persistence) for free.
- The **same router** can be deployed as the optional Relay for web/desktop, multi-store
  aggregation and extension backends, with no code change in screens.
- Tests run the router against recorded Spree fixtures without a device.

### 3.2 Packages (pnpm + Turborepo monorepo)

| Path | Package | Responsibility |
| --- | --- | --- |
| `apps/mobile` | — | Expo app. Routes, screens, notification handling, secure storage. |
| `apps/relay` | — | Optional Node service (Hono + tRPC fetch adapter). Webhook ingest, push fan-out, scheduled digests, extension proxy. Docker image + one-click deploys. |
| `apps/docs` | — | Docs site (Starlight). Generated compatibility matrix lives here. |
| `packages/domain` | `@instincts/spree-domain` | zod schemas for normalised models: `Order`, `LineItem`, `Shipment`, `Payment`, `Refund`, `Product`, `Variant`, `StockItem`, `Customer`, `Address`, `Promotion`, `Store`, `Money`. |
| `packages/spree-sdk` | `@instincts/spree-sdk` | Framework-free Spree client: fetch transport, retries, auth strategies, capability probe, adapters mapping Spree payloads to domain models. Usable outside the app (CLI, scripts, other projects). |
| `packages/api` | `@instincts/spree-api` | tRPC `appRouter`, context, `requireCapability` middleware, typed errors. |
| `packages/ui` | `@instincts/spree-ui` | Design tokens (one source → TS + NativeWind preset), primitives, commerce patterns (`ResourceList`, `MoneyText`, `StatusBadge`, `Timeline`, `ActionSheet`). |
| `packages/extension-sdk` | `@instincts/spree-extension-sdk` | `defineExtension()`, slot types, permission model, Blocks schema. |
| `packages/config` | `@instincts/spree-config` | Shared tsconfig, lint, test presets. |
| `extensions/*` | `@instincts/spree-ext-*` | First-party extensions (analytics, reviews, digital goods, …). |
| `gems/spree_admin_native` | `spree_admin_native` | Optional Rails engine for Spree ≥ 4.2 (see §6). |
| `distributions/default` | — | The upstream distribution: name, icons, theme, enabled extensions, EAS config. |

### 3.3 Capability negotiation

On connect, `spree-sdk` builds a `Capabilities` object and caches it per store:

1. `GET /api/admin_native/v1/capabilities` (companion gem). Authoritative if present.
2. Otherwise probe, in parallel, with short timeouts:
   - `GET /api/v3/admin/...` → 401/200 means Admin API v3 exists.
   - `GET /api/v2/platform/...` → 401/200 means Platform API v2 exists.
   - Storefront store endpoint for name, currency, locale, and any version hints.
3. Map the API family plus feature probes to a capability set:

```ts
type Capability =
  | 'orders.read' | 'orders.cancel' | 'orders.capture' | 'orders.refund' | 'orders.note'
  | 'shipments.ship' | 'shipments.split'
  | 'products.read' | 'products.write' | 'products.media'
  | 'inventory.adjust'
  | 'customers.read' | 'customers.write'
  | 'promotions.read' | 'promotions.write'
  | 'settings.store' | 'settings.shipping' | 'settings.tax' | 'settings.payments'
  | 'analytics.summary'                // gem or admin-v3
  | 'notifications.push'               // gem, or webhooks + relay
  | 'webhooks.manage'                  // Spree ≥ 4.5 (verify) / 5.3 Webhooks 2.0
  | 'markets' | 'priceLists' | 'giftCards' | 'channels'; // 5.x features
```

Procedures declare what they need (`requireCapability('orders.refund')`). If missing, they
throw `CAPABILITY_UNAVAILABLE` with a reason the UI shows in plain words, e.g. *"Refunds from
the app need Spree 4.5 or the companion gem."*

### 3.4 Compatibility (revised 2026-11-26 from live findings)

Established against Dockerised stores; details in `infra/spree/FINDINGS.md`, proven results in
`docs/compatibility.md` (generated).

| Spree | Admin API the app uses | Sign-in | Push notifications |
| --- | --- | --- | --- |
| 4.2 – 4.3 | **API v1** (legacy REST; Platform v2 has no orders until 4.4.0) | Admin user's API key (`X-Spree-Token`), or QR pairing with the gem | Companion gem, else background polling |
| 4.4 – 5.3 | Platform API v2 | OAuth application ID + secret with the `admin` scope | Gem, or Platform webhooks (4.4+) + Relay |
| 5.4 – 5.x | Admin API v3 (v2 via `spree_legacy_api_v2`) | Email + password (JWT) or secret API key (`X-Spree-Api-Key`) | Gem, or webhook endpoints + Relay |
| 6.0 + (current: 6.0.6, Oct 2026) | Admin API v3 | Email + password (JWT) or secret API key | Gem, or webhook endpoints + Relay |

CI runs the `spree-sdk` contract suite against Dockerised Spree **4.2 and 6.0** today; 4.3, 4.10
(Platform v2), 5.5 and later versions join the matrix in Phase 1.

### 3.5 Authentication (revised)

| Method | Works on | UX |
| --- | --- | --- |
| **Email + password** | Admin v3 (5.4+): `POST /api/v3/admin/auth/login` → 5-minute JWT; 30-day HttpOnly refresh cookie that rotates on each refresh, no CSRF token. Proven live on 6.0. | Shopify-like. The app keeps the cookie value in the keychain and replays it on refresh; the OS cookie jar is the fallback. |
| **API key** | API v1 (4.2–4.x): the admin's own Spree API key as `X-Spree-Token`. Admin v3: secret key `sk_…` as `X-Spree-Api-Key`. | Paste once. On 4.2–4.3 this is the only way without the gem: no OAuth grant reaches admin data. |
| **OAuth application** | Platform v2 (4.4–5.x): client credentials, or password grant with the app's ID/secret. | For stores on the Platform API. |
| **Scan pairing code** | Any, with the gem | "Pair device" in Spree admin shows a QR; the gem issues a scoped, revocable device token. Becomes the recommended path for 4.x stores. |

Credentials live in `expo-secure-store`. Optional Face ID / fingerprint lock on open. Multiple
stores and accounts are supported with a Shopify-style store switcher.

### 3.6 Data, caching and offline

- TanStack Query persisted to MMKV: last-seen orders, products and dashboard open instantly
  and work read-only offline.
- Money is `{ amount: string; currency: string }` (decimal string, never float), formatted
  with `Intl.NumberFormat`.
- Mutations require connectivity, apart from order notes, which queue and replay.
- Lists use cursor/page abstraction in `spree-sdk` so adapters can differ (JSON:API page
  numbers in v2, v3 pagination) without UI changes.

## 4. Product surface

### 4.1 Navigation (Native Tabs)

**Home · Orders · Products · Customers · More**, plus a global search sheet (pull down on
Home or ⌘K on iPad/web) that finds orders by number (`R123456789`), customers by email and
variants by SKU or barcode.

### 4.2 Screens by phase

**MVP (v0.1 – v0.3)**

- *Connect store*: URL → capability probe → sign in. Shows what this store supports before sign-in.
- *Home*: today's sales with sparkline vs. last week, orders to fulfil, payments to capture,
  low stock, recent activity. Every card is a deep link.
- *Orders*: segmented filters (Unfulfilled, Unpaid, Open, All), search, swipe actions.
- *Order detail*: status header, line items, customer, addresses, payments, shipments,
  a timeline of events and notes. Actions: **Fulfil** (pick shipment, scan or type tracking,
  mark shipped), **Capture**, **Refund** (line or amount), **Cancel**, **Resend confirmation**,
  **Add note**.
- *Products*: grid/list with thumbnails, stock badges, quick stock adjust (± stepper with
  reason), barcode scan to jump to a variant, edit price and availability.
- *Customers*: list, detail with lifetime spend, order history, addresses; call/email actions.
- *Notifications*: new order (with "till" sound), high-value order threshold, low stock,
  refund requested, failed payment. Per-store, per-type toggles and quiet hours.

**v0.5 – v1.0 (full store config)**

- Product create/edit with camera photos, variants, option types, properties, taxons.
- Promotions: create code, set rules and actions, pause/resume.
- Settings: store details, shipping methods and zones, tax categories and rates, payment
  methods, stock locations, staff (admin users and roles), returns.
- Analytics: sales, orders, AOV, top products, by channel/market where available.
- iPad and web: split view (list + detail), keyboard shortcuts.
- Home-screen widget ("Today's sales"), iOS Live Activity for "order being fulfilled" (later).

### 4.3 Experience details that make it feel native

- Haptics on fulfil / capture success; till sound on new order, shipped with the app (our
  own recording, not Shopify's).
- Optimistic status changes with undo toast for reversible actions.
- Order numbers, shipment numbers (`H…`) and payment numbers (`P…`) rendered in mono and
  long-press to copy.
- Every destructive action shows the amount and effect before confirming
  ("Refund $42.00 to Visa •••• 4242").
- Dynamic Type, VoiceOver/TalkBack labels, 44pt targets, reduced-motion respected.

## 5. Extensions and marketplace

Three tiers, chosen to stay inside App Store rule 2.5.2 (no downloaded executable code that
changes the app's features):

| Tier | Runs where | Ships how | Who it is for |
| --- | --- | --- | --- |
| **Built-in extensions** | In the app bundle | Compiled in; merchants enable per store from the Marketplace screen | First-party and vetted community extensions |
| **Blocks extensions** | Extension's own server (any language, Ruby included) | Listed in the registry; app calls the server and renders a declarative block tree with host components | Spree extension authors, agencies |
| **Native extensions** | In a fork's bundle | Added to a distribution | White-label forks (e.g. Beeper) |

**Slots** an extension can contribute to: `home.cards`, `order.detail.sections`,
`order.detail.actions`, `product.detail.sections`, `customer.detail.sections`,
`settings.sections`, `more.items`, `notifications.types`, plus full routes for native
extensions.

**Manifest** (`extension.json`): id, name, version, publisher, compatibility
(`spree: ">=4.2"`, required capabilities, required Spree gem), permissions
(`orders:read`, `orders:write`, …), contributions, and for Blocks extensions the endpoint
URL and a public key used to verify signed responses.

**Blocks** are a small, versioned JSON schema (`text`, `money`, `badge`, `keyValue`,
`list`, `image`, `button`, `form`, `divider`, `banner`). Buttons and forms post actions back
to the extension server with the context (store, resource id) and a short-lived signed
token. The server returns a new block tree or a toast. Think Slack Block Kit for Spree.

**Registry**: a public Git repository (`spree-admin-native-extensions`) with one folder per
extension. Adding one is a pull request reviewed by maintainers; CI validates the manifest,
pings the endpoint and checks compatibility claims. The app reads a signed index built from
that repo. Forks can point at their own registry.

**Pairing with Spree gems**: an extension can declare the Ruby gem it pairs with
(`spree_reviews`, `spree_digital`, `spree_loyalty_points`), so the Marketplace can say
*"Install `spree_reviews` on your store to use this"*.

## 6. Companion gem: `spree_admin_native` (optional)

A Rails engine for Spree ≥ 4.2 that fills gaps older APIs leave:

- `GET /api/admin_native/v1/capabilities` — Spree version, installed extensions, features.
- `POST/DELETE /api/admin_native/v1/devices` — register Expo push tokens per admin user.
- Push on events (order completed, payment failed, low stock, return authorised) sent
  directly to the Expo Push API from a background job. Hooks into `Spree::Order` state
  transitions on 4.x and the event bus on 5.x.
- `GET /api/admin_native/v1/summary` — aggregates for Home (sales today, to-fulfil count,
  low-stock count) computed in SQL instead of paging every order through the API.
- Device pairing: admin page with a QR code, short-lived pairing token, device list with revoke.
- Endpoint parity shims where Platform v2 lacks an action on old versions (e.g. refunds),
  listed by contract tests.

Without the gem the app still works: Home computes from API pages (fine for small stores),
and notifications fall back to background fetch with local notifications.

## 7. Optional Relay (`apps/relay`)

Self-hosted (Docker, Fly, Render, Railway; SQLite or Postgres via Drizzle). Use it when you want:

- Push from Spree webhooks with no gem (Spree with webhooks): verifies HMAC, fans out to
  Expo Push for every registered device.
- Daily or weekly digest notifications.
- One endpoint for several stores (agencies).
- Hosting the app's web build with the router server-side.

It stores webhook secrets and device tokens; it stores store credentials only if the owner
opts in to server-side mode.

## 8. Forking and distributions

The fork contract, in short (full version in `docs/forking.md`):

- Everything brand-specific lives in `distributions/<name>/`: `distribution.config.ts`
  (name, slug, bundle IDs, EAS project, deep-link scheme, default store URL, enabled
  extensions, feature flags), `theme.ts` (token overrides), `assets/` (icon, splash, sounds),
  `extensions/` (native extensions).
- `app.config.ts` reads `APP_DISTRIBUTION` (default `default`) and builds from that folder.
- Upstream never edits a non-default distribution; forks never edit outside their
  distribution and `extensions/`. Upstream merges stay conflict-free.
- A scheduled GitHub Action in each fork opens an "Sync upstream" pull request.

## 9. Design language

Summary here; full detail in `docs/design/design-language.md`.

- **Concept: "the counter".** The app is the shop counter in your pocket: receipts, packing
  slips, tally counts. Calm surfaces, dense lists, big honest numbers.
- **Type**: Bricolage Grotesque for display (money figures, screen titles), Geist for UI
  text, Geist Mono for order/SKU/tracking numbers and tabular money.
- **Colour**: neutral stockroom greys with a cool bias, ink text, and one accent,
  **marigold**, reserved for money-in moments (new order, today's total, primary CTA).
  Semantic colours for status are separate from the accent.
- **Signature details**: the order timeline renders as a receipt tape with a perforated
  edge; Spree's `R`/`H`/`P` number prefixes are set as small glyphs on badges; the new-order
  push and in-app banner share one "ticket" shape.
- **Distinct from Shopify**: no green-led palette, no Polaris clones; patterns are familiar,
  the look is ours.

## 10. Tech choices

| Area | Choice | Why |
| --- | --- | --- |
| App runtime | Expo SDK 58, React Native New Architecture, Expo Router (Native Tabs) | Current stable SDK; native tabs and file routes; EAS Build/Update/Submit |
| Contract | tRPC v11 + `@trpc/tanstack-react-query` | Typed, local or remote, TanStack Query native |
| Validation | zod 4 | Shared by domain, router and Blocks schema |
| Styling | NativeWind with tokens from `@instincts/spree-ui` (CSS variables for runtime themes) | Same Tailwind vocabulary as `dna-frontend`; theme swap per distribution |
| Lists | FlashList v2 | Large order/product lists |
| Motion | Reanimated 4, Gesture Handler | Swipe actions, sheets |
| Charts | Victory Native (Skia) | Sparklines and analytics |
| Storage | `expo-secure-store` (secrets), `react-native-mmkv` (cache) | |
| Device | `expo-notifications`, `expo-camera` (barcodes), `expo-haptics`, `expo-local-authentication`, `expo-image`, `expo-background-task` | |
| i18n | Lingui, community translation via Crowdin/Weblate | OSS-friendly extraction |
| Tests | Vitest (packages), Jest + RNTL (app), Maestro (E2E), contract suite vs Docker Spree | |
| Repo | pnpm, Turborepo, Biome, Changesets, Renovate, GitHub Actions | |
| Errors | Sentry, off by default, enabled per distribution | Privacy by default |

## 11. Open source operations

- **License**: MIT (matches the Spree ecosystem's permissive licensing; easy for agencies to fork).
- **Governance**: maintainers file, ADRs in `docs/adr`, RFCs for extension API changes.
- **Releases**: Changesets for packages; app versions via EAS; OTA updates for JS-only fixes
  through the `production` channel; public TestFlight and Play open testing.
- **Docs**: getting started per Spree version, gem install, relay deploy, writing an
  extension, forking guide, generated compatibility matrix.
- **Community**: good-first-issue labels, issue templates including a "My Spree version
  does X" compatibility report, Discussions for ideas, all-contributors.
- **Security**: `SECURITY.md` with private reporting via GitHub advisories; secrets only in
  secure storage; dependency review and secret scanning in CI.

## 12. Roadmap

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 0 Foundations | Monorepo, CI, Docker Spree matrix, `domain`, `spree-sdk` transport + auth + probe, `api` skeleton, `ui` tokens, app shell with Connect flow | Connect to 4.2 and latest, see capabilities on device |
| 1 Pocket admin (v0.1) | Home, Orders list/detail, fulfil/capture/refund/cancel, Products read + stock adjust, Customers read, gem v0.1 with push + pairing | Internal TestFlight; Beeper uses it daily |
| 2 Full store (v0.5) | Product edit/create, promotions, settings, analytics, iPad/web layouts | Public beta |
| 3 Extensions (v0.8) | extension-sdk, slots, Blocks, registry, Marketplace screen, Relay | 3 first-party + 1 community extension |
| 4 v1.0 | Widgets, i18n (5 languages), accessibility audit, docs site, store listings | Public App Store / Play release |

## 13. Risks and open questions

| Risk / question | Plan |
| --- | --- |
| Spree 4.2–4.3 have no Platform API and no refund endpoint (API v1 only has `payments/:id/credit`) | API v1 adapter; refunds on 4.x come from the gem; UI shows the reason when unavailable |
| No password sign-in reaches admin data on 4.2 (answered by the Phase 0 spike) | API key sign-in now; QR pairing via the gem in Phase 1 |
| `localLink` stability in RN | Phase 0 spike; small custom link as fallback |
| Expo push tokens are tied to an app's EAS project; forks need their own | Gem stores the token's project; documented per distribution |
| App Store review for an app that connects to arbitrary servers | Ship a demo store and reviewer credentials; clear onboarding copy |
| Admin API v3 keeps moving (Spree 6 shipped Oct 2026 with a React admin on the same API) | Adapters isolate it; v3 adapter uses `@spree/admin-sdk` types; v3 also gives us `/me` permission keys and `/dashboard/counters` for Home |
| "Spree" is a trademark; using it in an App Store name may need permission | Check Spree trademark guidance before the store listing (see §14) |

## 14. Decisions needed from the maintainer

1. App Store display name (repo is `spree-admin-native`; check trademark use of "Spree").
2. Beeper fork repo (`Beeper-Buzz/beeper-admin-native` assumed). Prefer a GitHub **fork** over "Use this template": template copies have no shared history, so upstream sync needs `--allow-unrelated-histories` once.
3. ~~Gem location~~ Decided: `gems/spree_admin_native` in this monorepo.
4. Whether to apply to have the app listed as a Spree community integration.
5. Claim the `@instincts` npm org before the first package publish.

## 15. Storefront kit (`expo-spree`)

The storefront kit lives in its own repo, [`1instinct/expo-spree`](https://github.com/1instinct/expo-spree),
with its own spec. It depends on this repo's `domain` and `spree-sdk` packages and reuses the
Docker Spree matrix (ADR 0009).
