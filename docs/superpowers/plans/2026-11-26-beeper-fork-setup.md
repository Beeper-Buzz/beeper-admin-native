# Beeper Fork Setup — Implementation Plan

> Execute with superpowers `executing-plans`. Depends on upstream Phase 0 Tasks 4, 12, 13.
> Commit format: `[Type]: Title. Changes:` with `1.` list items.

**Goal:** A Beeper-branded build running against a staging copy of `admin.beeper.buzz`,
with orders, push and the Moderation extension working.

## Task 1: dna-admin staging fixture store
- [ ] Add a `docker-compose.contract.yml` to `dna-admin` that boots it with anonymised seed
      data (orders in every state, 5 content reports, 3 support threads, 2 IAP transactions).
- [ ] Upstream contract suite runs green against it as "4.2.5-dna".

## Task 2: Companion gem in dna-admin
- [ ] Add `spree_admin_native` (path or git ref until published) to `dna-admin/Gemfile`.
- [ ] Mount; run migrations; verify `GET /api/admin_native/v1/capabilities` lists `beeper.*`
      capabilities from a `config/initializers/admin_native.rb` registration.
- [ ] Order-complete push reaches a dev build.

## Task 3: Distribution
- [ ] `distributions/beeper/distribution.json` (spec §3).
- [ ] `distributions/beeper/theme.ts` (spec §4); token contrast test passes in dark.
- [ ] Icon, splash, Δ8 blip sound (`.caf` iOS, `.wav` Android).
- [ ] `APP_DISTRIBUTION=beeper` dev build boots locked to staging store.

## Task 4: Moderation API in dna-admin (TDD, request specs first)
- [ ] `GET /api/v1/beeper/content_reports?q[status_eq]=open` (API v1 auth; Spree 4.2 has no Platform API)
- [ ] `PUT /api/v1/beeper/content_reports/:id/{dismiss,hide_profile,remove_photo,clear_bio,lock_account}`
- [ ] Reuse logic from `Spree::Admin::ContentReportsController`; extract to a service first
      so HTML and API share it.
- [ ] Push "New report" on `ContentReport` create.

## Task 5: Moderation extension
- [ ] `distributions/beeper/extensions/moderation`: queue list, report detail with the
      reported content, action sheet with confirm sentences ("Lock @handle's account?").
- [ ] `home.cards`: "3 reports to review".
- [ ] RNTL tests + Maestro flow against the fixture store.

## Task 6: Support inbox (API + extension)
- [ ] Same shape as Tasks 4–5 for threads/messages; decide Pusher vs polling (spec §8.3).

## Task 7: Upstream sync drill
- [ ] Run the Sync upstream workflow manually; confirm a conflict-free merge.
