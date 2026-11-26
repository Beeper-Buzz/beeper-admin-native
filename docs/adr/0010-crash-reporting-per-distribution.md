# 10. Crash reporting with Sentry, configured per distribution

Date: 2026-11-26

## Status

Accepted

## Context

The first TestFlight build of a fork crashed at launch with a JavaScript error that the iOS crash
report doesn't contain: expo-updates' error recovery aborts the app and only its own frames reach
the report. Every fork needs a way to see such errors, but each owns its Sentry account, and the
upstream app must not send anything anywhere by default.

## Decision

1. `@sentry/react-native` is part of the app; `startSentry()` runs before any other module and
   does nothing without a DSN.
2. Each distribution configures it in `distribution.json` (`sentry.dsn`, `organization`,
   `project`), overridable by `SENTRY_DSN` / `SENTRY_ORG` / `SENTRY_PROJECT` at build time. The
   upload plugin is only added when an organization and project are known.
3. Privacy defaults are fixed in code, not configuration: no default PII, credential headers and
   token parameters scrubbed from events and breadcrumbs, nothing sent from development.
4. The root layout exports an `ErrorBoundary` that reports render errors and offers a retry
   instead of closing the app.

## Consequences

1. Forks get crash reports by adding three values and an EAS secret, without code changes.
2. Release builds of the upstream app send nothing until a DSN is configured.
3. Builds with a configured project but no `SENTRY_AUTH_TOKEN` still succeed
   (`SENTRY_ALLOW_FAILURE`), with unsymbolicated traces.
