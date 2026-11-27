# App version gate

A store can require a minimum version of the admin app, and recommend a newer one. Below the
minimum, the app shows a full-screen "Update required" screen. Below the recommended version, it
shows a dismissible "Update available" dialog. Store staff set both in Spree's Rails admin, on
the companion gem's admin app page. Companion gem 0.6.

The gate belongs to the store, so one store's settings never touch another store or another app.
A store that has never set a version has no gate.

## Storage (gem)

Table `spree_admin_native_app_versions` (migration in the gem, `if_not_exists` like the
existing one):

| Column | Type | Notes |
| --- | --- | --- |
| `platform` | string, not null | `ios`, `android` or `all` |
| `minimum_version` | string, null | Semantic `x.y.z`; blank means no minimum |
| `recommended_version` | string, null | Semantic; at or above `minimum_version` when both are set |
| `update_url` | string, null | Where the Update button goes (App Store, TestFlight or Play link); `https` only |
| `allow_ahead_of_store` | boolean, default false | Skips the App Store check below |
| timestamps | | |

There is one row per platform (unique index on `platform`). For a platform, the effective
settings are its own row when one exists, otherwise the `all` row, otherwise none.

Model `SpreeAdminNative::AppVersion`:

1. It validates the formats, `recommended >= minimum` (compared with `Gem::Version`) and the
   `https` URL.
1. **App Store check.** For `ios` and `all` rows, unless `allow_ahead_of_store` is ticked, the
   minimum and the recommended version must not be above what the App Store serves.
   1. The lookup is `https://itunes.apple.com/lookup?bundleId=<config.ios_bundle_id>`. It is
      skipped when `SpreeAdminNative.config.ios_bundle_id` is blank.
   1. A failed lookup or a missing app counts as "not live", with a message telling the admin to
      tick the box.
   1. The lookup uses `Net::HTTP` with a 5 s timeout; no new gem dependencies.
1. `SpreeAdminNative::AppVersion.effective(platform)` returns
   `{ minimum_version:, recommended_version:, update_url: }`, with nils when there are no
   settings. An unknown platform reads the `all` row.

Config (in the gem's existing config object):

| Config | Purpose |
| --- | --- |
| `ios_bundle_id` | The bundle id for the App Store check; default nil |
| `app_version_gate` | Set it to false to turn the feature off; default true |

## API (gem)

`GET /api/admin_native/v1/app_version?platform=ios&version=1.2.3` (public, no auth).

1. It is public because an outdated app must reach it before sign-in, and it reveals nothing
   but version numbers and a store link.
1. It is rate limited the way the gem's other public endpoints are, if they are.

Response 200:

```json
{
  "data": {
    "minimum_version": "1.0.0",
    "recommended_version": "1.1.0",
    "update_url": "https://apps.apple.com/app/id123",
    "update_required": true,
    "update_recommended": false
  }
}
```

1. The fields are null when nothing is set.
1. `update_required` and `update_recommended` are computed only when `version` is sent and
   parses. Otherwise both are false, and the app compares versions itself.
1. A minimum of `0.0.0` means no minimum.

The capabilities response gains `app.versionGate` when the feature is on, so the app knows the
endpoint exists. It is a capability string in the existing list.

## Rails admin page (gem)

The gem's admin app page (`spree/admin/admin_native_devices#index`, "Admin app") gains an
**App versions** section:

1. One form per platform row (iOS, Android, All), each with: Minimum version, Recommended
   version, Update link, and "Allow ahead of the App Store" (iOS and All only).
1. Hints:
   1. "Below the minimum, the app can't be used until it's updated."
   1. "Below the recommended version, people are asked, not forced, to update."
   1. "Leave a version blank for none."
1. Save shows validation errors inline. Clearing both versions and the link deletes the row.
1. The page shows what each platform currently gets.
1. Routes: `resources :admin_native_app_versions, only: %i[create update destroy]` (or a
   singular `update` keyed by platform) under the same admin namespace.
1. It uses the same Spree admin layout and authorization as the devices page.

## App

1. **Distribution.** `distribution.json` gains an optional `storeUrls: { ios?, android? }`.
   1. It is the fallback Update link when the store sends none.
   1. `distributions/types.ts` documents it.
   1. `distributions/beeper/distribution.json` sets `ios` to
      `https://apps.apple.com/app/id6839775671` (the app's ASC id).
1. **SDK.** A companion method `appVersion(platform, version)` returns
   `{ minimumVersion, recommendedVersion, updateUrl, updateRequired, updateRecommended }`, or
   null.
   1. It is used only when the probe has `app.versionGate`.
   1. Every failure (network, timeout of 5 s, bad payload) returns null, so the gate fails
      open.
1. **Checks.**
   1. When a store is connected: at launch, after sign-in, and when the app returns to the
      foreground, at most every 30 minutes.
   1. No launch waits on it. The app shows at once, and the gate or prompt appears when the
      answer comes.
   1. The installed version is `expo-application`'s `nativeApplicationVersion`. The app
      compares versions itself too, with a small semver compare in `packages/domain`: coerce
      `1.2` to `1.2.0`, and drop prerelease tags. That way an older gem without the booleans
      still works.
1. **Below the minimum: "Update required" screen.** It covers the app, including tabs and
   sheets.
   1. It shows the installed version and the minimum.
   1. **Update** opens the store's `update_url`, else the distribution's store URL. With no
      link, the button is hidden and the text says to ask the store's admin.
   1. **Switch store** disconnects or signs out, so someone with several stores isn't locked
      out of the others.
   1. Accessible, with Dynamic Type.
1. **Below the recommended version: "Update available" dialog.**
   1. A small card in the app's design language (or a native `Alert`, if that is the app's
      convention for prompts).
   1. Buttons: **Update** and **Not now**.
   1. Not now snoozes for 24 hours per store and per recommended version, kept in the app's
      existing storage. A newer recommended version prompts again at once.
   1. It appears at most once per session, never over the Update required screen, and never
      while a form sheet is open (it waits until the sheet closes).
1. **Sentry.** Breadcrumbs only. A gate that closes is not an error.

## Not in scope

The consumer app (BeeperNative) already has its own gate on dna-admin's `app_settings`. This
gate is for the admin app only, and it doesn't read or change `app_settings`.
