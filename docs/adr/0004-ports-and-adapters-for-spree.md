# 4. Ports and adapters for Spree APIs

- Status: Accepted · 2026-11-26

## Decision
`@instincts/spree-sdk` defines ports (`OrdersPort`, `ProductsPort`, …) returning
`@instincts/spree-domain` types. Adapters: `platform-v2` (Spree 4.2 → 5.x with legacy v2) and
`admin-v3` (Spree 5.4+). A shared conformance suite runs against every adapter.
