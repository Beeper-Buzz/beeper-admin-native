# Phase 0: Foundations — Implementation Plan

> **For agentic workers:** execute task by task (superpowers `executing-plans` or
> `subagent-driven-development`). Each task is TDD: failing test → run → implement → run →
> commit. Do not skip the "run" steps. Commit format follows the maintainer's convention:
> `[Feature]: Title. Changes:` followed by `1.` list items.

**Goal:** A monorepo where `spree-sdk` can connect to Spree 4.2 and the latest Spree, detect
capabilities, sign in, and list orders as normalised domain objects, exposed through a tRPC
router that the Expo app calls in-process, with a Connect Store screen that shows the result.

**Architecture:** see `docs/superpowers/specs/2026-11-26-spree-admin-native-design.md` §3.

**Tech stack:** pnpm 10, Turborepo, TypeScript 5.9 strict, zod 4, Vitest, tRPC v11,
Expo SDK 58, Docker Compose (Spree matrix).

**Exit criteria:**

- `pnpm test` green across packages.
- `pnpm contract --spree 4.2` and `--spree latest` green against Docker.
- On an iOS simulator, entering `http://localhost:3042` shows "Spree 4.2 · Platform API v2"
  and its capability list, signs in with the sample admin and shows 25 orders.

## Status (updated 2026-11-26)

| Task | Status | Notes |
| --- | --- | --- |
| 1 Workspace tooling | Done | pnpm 10, Turborepo, Biome 2.6, Vitest 5, TS 5.9 (app uses Expo's TS 6) |
| 2 Money | Done | bigint minor units, Intl formatting |
| 3 Domain models | Done, revised | Order vocabulary changed to Spree 6's (`status`, `paymentStatus`, `fulfillmentStatus`, fulfillments) after reading `@spree/admin-sdk` 6.0.6; Spree 4 states map into it in the adapter |
| 4 Docker matrix | Done | Spree 4.2.7 on :3042 (built) and 6.0.6 on :3060 (official image); `node scripts/spree-up.mjs`; findings in `infra/spree/FINDINGS.md`. Migrations renumbered at build so rebuilt images match existing databases |
| 5 Transport | Done | Injected `fetch` instead of msw; same error kinds as BeeperNative |
| 6 Capability probe | Done | Probes run in parallel; gem answer preferred (not probed first, to avoid an extra round trip). Admin v3 detected via unauthenticated `/api/v3/admin/auth/providers` |
| 7 Auth | Done | Spike answered: no password sign-in reaches admin data on 4.2. API v1 key (`X-Spree-Token`), Admin v3 secret key, Admin v3 JWT login with rotating refresh cookie (proven live), OAuth client credentials for Platform v2 |
| 8 Spree 4.x orders | Done, revised | 4.2 has no Platform orders: new `api-v1` adapter, tested on recordings and live. The `platform-v2` adapter (4.4–5.x) stays written but unproven (ADR 0008) |
| 9 Admin v3 orders | Done | Tested on recordings and live; numbers like `R1029-F1`; lookup by number goes through `q[number_eq]` |
| 10 Contract suite | Done | 24 live tests green on 4.2 and 6.0 (API key and JWT runs); credentials read from `spree-up --json`, never stored |
| 11 Router | Done | `store.probe`, `store.signIn`, `store.current`, `orders.list`, `orders.get`; `unstable_localLink` proven in tests and in a Hermes bundle |
| 12 Tokens | Done | Contrast checks in tests; no Tailwind preset yet (app uses StyleSheet + tokens) |
| 13 App shell | Done | Expo SDK 58, Native Tabs; distribution identity is JSON (Expo's config loader can't require TS at runtime) |
| 14 Connect flow | Done | RNTL 14 integration test (async `render`); Maestro flow still to do |
| 15 Review | Not started | |

---

## Task 1: Workspace tooling

**Files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`,
`biome.json`, `.nvmrc`, `packages/config/*`

- [ ] Root `package.json` scripts: `build`, `dev`, `lint`, `typecheck`, `test`, `contract`
      all delegating to `turbo run <task>`.
- [ ] `packages/config` exports `tsconfig.lib.json` (strict, `noUncheckedIndexedAccess`,
      `exactOptionalPropertyTypes`) and `vitest.preset.ts`.
- [ ] Run `pnpm install && pnpm typecheck` → passes with zero packages.
- [ ] Commit: `[Chore]: Workspace tooling. Changes:`

## Task 2: `@instincts/spree-domain` — Money

**Files:** `packages/domain/src/money.ts`, `packages/domain/src/money.test.ts`

- [ ] Write failing tests:

```ts
import { describe, expect, it } from 'vitest';
import { Money, money, addMoney, formatMoney } from './money';

describe('Money', () => {
  it('parses Spree decimal strings without float drift', () => {
    expect(Money.parse({ amount: '19.99', currency: 'USD' })).toEqual({ amount: '19.99', currency: 'USD' });
  });
  it('rejects numbers', () => {
    expect(() => Money.parse({ amount: 19.99, currency: 'USD' })).toThrow();
  });
  it('adds in minor units', () => {
    expect(addMoney(money('0.10', 'USD'), money('0.20', 'USD'))).toEqual(money('0.30', 'USD'));
  });
  it('refuses to add different currencies', () => {
    expect(() => addMoney(money('1', 'USD'), money('1', 'EUR'))).toThrow(/currency/);
  });
  it('formats with Intl', () => {
    expect(formatMoney(money('1234.5', 'USD'), 'en-US')).toBe('$1,234.50');
  });
});
```

- [ ] `pnpm --filter @instincts/spree-domain test` → fails (module missing).
- [ ] Implement with `bigint` minor units internally (currency exponent from
      `Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits`).
- [ ] Tests pass. Commit.

## Task 3: `@instincts/spree-domain` — Order, LineItem, Shipment, Payment, Customer

**Files:** `packages/domain/src/{order,shipment,payment,customer,address,product}.ts` + tests

- [ ] Write schema tests from fixtures in `packages/domain/test/fixtures/*.json` (hand-made,
      domain-shaped). Assert enums: `OrderState` (`cart|address|delivery|payment|confirm|complete|canceled|returned|awaiting_return|resumed`),
      `PaymentState` (`balance_due|paid|credit_owed|failed|void|null`),
      `ShipmentState` (`pending|ready|partial|shipped|backorder|canceled`).
- [ ] Every Spree number field is `number: string` matching `/^[A-Z]\d+$/`.
- [ ] Implement; tests pass. Commit.

## Task 4: Docker Spree matrix

**Files:** `infra/spree/Dockerfile.4.2`, `infra/spree/Dockerfile.latest`,
`infra/spree/docker-compose.yml`, `infra/spree/seed.rb`, `scripts/spree-up.mjs`

- [ ] 4.2 image: Ruby 2.7, Rails 6.1, `spree 4.2.x`, `spree_auth_devise`, sample data, an
      OAuth application with `admin` scope; port 3042.
- [ ] Latest image: current Spree 5 with sample data and an Admin API secret key; port 3050.
- [ ] `seed.rb` creates admin `admin@example.com / spree123`, 25 completed orders across
      states (5 unfulfilled, 3 balance due, 2 canceled), one low-stock variant.
- [ ] `node scripts/spree-up.mjs 4.2` waits for health and prints credentials.
- [ ] Verify: `curl -s localhost:3042/api/v2/storefront/products | jq '.data | length'` → > 0.
- [ ] Commit.

## Task 5: `spree-sdk` transport

**Files:** `packages/spree-sdk/src/transport.ts` + `transport.test.ts`

- [ ] Tests with `msw` (node) for: base URL joining, JSON:API `Accept` header, timeout →
      `SpreeError{kind:'timeout'}`, 401 → `kind:'unauthorized'`, 404 → `notFound`,
      422 → `invalid` with field errors, 429 with `Retry-After`, network failure → `network`.
- [ ] Port the error taxonomy from BeeperNative `src/api/http` (kinds, retry policy) so
      both codebases share vocabulary.
- [ ] Implement; tests pass. Commit.

## Task 6: Capability probe

**Files:** `packages/spree-sdk/src/capabilities/{probe,map,types}.ts` + tests

- [ ] Tests (msw) covering four stores:
  - gem present → uses `/api/admin_native/v1/capabilities` verbatim, no other probes.
  - 4.2-like (platform 401, v3 404) → `apiFamily: 'platform-v2'`, has `orders.read`,
    no `webhooks.manage`.
  - 5.5-like (v3 401, platform 404) → `apiFamily: 'admin-v3'`, has `webhooks.manage`.
  - neither → throws `SpreeError{kind:'notSpree'}` with message
    "This address doesn't look like a Spree store (no Platform or Admin API found)."
- [ ] Probes run in parallel, each with a 4s timeout; total under 5s.
- [ ] Implement; tests pass. Commit.

## Task 7: Auth strategies

**Files:** `packages/spree-sdk/src/auth/{password,clientCredentials,apiKey,types}.ts` + tests

- [ ] `AuthStrategy` interface: `headers(): Promise<Record<string,string>>`,
      `refresh?(): Promise<void>`, `serialize(): StoredCredential`.
- [ ] Password grant: `POST /spree_oauth/token` with `grant_type=password&scope=admin`;
      refresh on 401 once, then surface `unauthorized`.
- [ ] API key: `x-spree-api-key` header.
- [ ] **Spike (time-boxed 2h):** against Docker 4.2, confirm an admin user's password-grant
      token with `scope=admin` can call `GET /api/v2/platform/orders`. Record result in
      `docs/adr/0007-auth-on-spree-4-2.md`. If it can't, the Connect flow on 4.2 offers
      OAuth app credentials until the gem's pairing ships.
- [ ] Commit.

## Task 8: Platform v2 adapter — orders

**Files:** `packages/spree-sdk/src/adapters/platform-v2/{orders,mapOrder,jsonapi}.ts` + tests

- [ ] Record real responses from Docker 4.2 and latest into
      `packages/spree-sdk/test/recordings/<version>/orders.*.json` with
      `pnpm record --spree 4.2` (script uses the live container).
- [ ] Unit tests map each recording to `Order` and validate with the zod schema.
- [ ] `listOrders({ filter: 'unfulfilled' | 'unpaid' | 'open' | 'all', cursor, q })` maps to
      `filter[shipment_state_not_eq]=shipped`, `filter[payment_state_eq]=balance_due`,
      etc. Include `line_items,shipments,payments,bill_address,user`.
- [ ] Commit.

## Task 9: Admin v3 adapter — orders

**Files:** `packages/spree-sdk/src/adapters/admin-v3/*` + tests

- [ ] Same tests as Task 8 against latest recordings. Use `@spree/admin-sdk` types where
      they help; keep our own mapping.
- [ ] Shared adapter conformance test: `describeOrdersPort(adapterFactory)` runs identical
      assertions for both adapters.
- [ ] Commit.

## Task 10: Contract suite

**Files:** `packages/spree-sdk/contract/*.contract.ts`, `scripts/contract.mjs`,
`.github/workflows/contract.yml`

- [ ] Contract tests hit live Docker Spree; each test is tagged with the capability it proves.
- [ ] Output `contract-results/<version>.json` (`{ capability: pass|fail|skip }`).
- [ ] `scripts/compat-matrix.mjs` turns results into `docs/compatibility.md`.
- [ ] CI matrix: 4.2 and latest now; 4.7, 4.10, 5.0, 5.3 added in Phase 1.
- [ ] Commit.

## Task 11: `@instincts/spree-api` router skeleton

**Files:** `packages/api/src/{trpc,context,router,errors}.ts`,
`packages/api/src/routers/{store,orders}.ts` + tests

- [ ] Tests with `createCaller`: `store.capabilities` returns the probe result;
      `orders.list` returns domain orders; calling a procedure that needs a missing
      capability throws `TRPCError` code `PRECONDITION_FAILED` with
      `cause.kind = 'CAPABILITY_UNAVAILABLE'` and a human message.
- [ ] Context carries `{ adapter, capabilities, storeId }`.
- [ ] Commit.

## Task 12: `@instincts/spree-ui` tokens

**Files:** `packages/ui/src/tokens/{color,type,space,radius,motion}.ts`,
`packages/ui/tailwind-preset.js`, `packages/ui/src/tokens/tokens.test.ts`

- [ ] Tokens from `docs/design/design-language.md`; light and dark.
- [ ] Test: every semantic token resolves in both themes; text/background pairs meet WCAG AA
      (compute contrast in test).
- [ ] Commit.

## Task 13: Expo app shell

**Files:** `apps/mobile/*`, `distributions/default/{distribution.config.ts,theme.ts,assets/}`

- [ ] `npx create-expo-app@latest apps/mobile --template tabs` then strip to Native Tabs:
      Home, Orders, Products, Customers, More.
- [ ] `app.config.ts` reads `APP_DISTRIBUTION` and loads `distributions/<name>`.
- [ ] tRPC client with `localLink` to `appRouter` (spike: confirm `unstable_localLink`
      runs under Hermes; else add `packages/api/src/localLink.ts`).
- [ ] Commit.

## Task 14: Connect Store flow

**Files:** `apps/mobile/app/(auth)/connect.tsx`, `apps/mobile/app/(auth)/sign-in.tsx`,
`apps/mobile/src/stores/credentials.ts` + RNTL tests

- [ ] Test: entering a URL calls `store.probe`, shows store name, API family and capability
      chips; unreachable URL shows the `notSpree` message.
- [ ] Sign in stores the credential in secure store keyed by store id.
- [ ] Orders tab lists `orders.list({filter:'all'})` with order number, customer, total,
      payment and shipment badges.
- [ ] Maestro flow `e2e/connect.yaml` against Docker 4.2.
- [ ] Commit.

## Task 15: Phase 0 review

- [ ] Run everything: `pnpm lint typecheck test && pnpm contract --spree 4.2 && pnpm contract --spree latest`.
- [ ] Request code review (superpowers `requesting-code-review`).
- [ ] Update the spec's §13 with spike results; write ADR 0007.
- [ ] Tag `v0.0.1`.
