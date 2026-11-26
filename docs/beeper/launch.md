# Beeper Admin: going live on EAS and the App Store

Everything in the repo is ready for `eas build` except the items marked **you**: accounts,
secrets and Apple decisions only the Beeper team can make.

## 0. Backend first

Beeper Admin talks to `admin.beeper.buzz` (Beeper-Buzz/Beeper-Admin, a fork of dna-admin).

1. Merge the Beeper-Admin PR that adds the `spree_admin_native` gem (it came from dna-admin #154).
   **you**
1. Deploy, run `bin/rails db:migrate`, open **/admin/admin_native_devices** and pair a phone.
1. Without the gem the app still works on 4.2, but sign-in is "paste your API key" only, and there
   are no notifications or sales summary.

## 1. Distribution values

`distributions/beeper/distribution.json` has the name, scheme, version `1.0.0`, the confirmed
bundle ID, the EAS project `@instincts/beeper-admin-native` (`30581af3-…`, linked to this
GitHub repo) and Apple team `5E3H5S4R65` (Material Instinct, LLC, the same team as BeeperNative).
Still to fill in:

| Field | Now | Needed from **you** |
| --- | --- | --- |
| `assets.icon`, `assets.splash`, `assets.adaptiveIconForeground` | missing (placeholder art) | A 1024×1024 icon distinct from the consumer app, splash mark, Android foreground |

Also set `APP_DISTRIBUTION=beeper` as an environment variable in the EAS project (all
environments, plain text). Builds started from expo.dev or GitHub need it to pick the Beeper
distribution.

The EAS project is linked to this GitHub repo. Because the app lives in a monorepo, set the
project's **Base directory** to `apps/mobile` in expo.dev → Project settings → GitHub before
starting builds from GitHub.

## 2. Apple

1. **App Store Connect record** for `com.beeper.admin` under Beeper's team (EAS can create it
   on first submit). **you**
1. **App Store Connect API key** (Issuer ID, Key ID, `.p8`) added to EAS credentials, so builds
   and submits run unattended. **you**
1. **Push key (APNs)**: let EAS generate it on the first build, or reuse BeeperNative's key.
1. **Distribution choice.** Beeper Admin is a tool for Beeper staff. Apple's guidance for internal
   business apps is a *Custom App* through Apple Business Manager (private to Beeper's org, same
   review), or *Unlisted App Distribution* (reachable only by link). A public listing of a staff
   tool risks rejection under the business-apps rules. Recommended: **Custom App** (needs an
   Apple Business Manager account) or **Unlisted**. **you** decide.

## 3. App Review access

Reviewers must sign in. Pairing needs a Spree admin session, so give them:

1. A **staff account with limited roles** on admin.beeper.buzz (or a staging store), and
1. An **admin API key** for that account, pasted in the review notes, with the steps:
   "Enter admin.beeper.buzz → Use an API key instead → paste the key".

Or point review at a sanitized staging store. Apple asks for generic test accounts, not real
customer data.

## 4. Store listing

Name ("Beeper Admin", check availability), subtitle, description, keywords, support URL,
privacy policy URL, iPhone 6.9" and 6.5" screenshots (and iPad 13" because `supportsTablet` is
on), age rating, and the App Privacy answers:

| Data | Collected | Linked to user | Purpose |
| --- | --- | --- | --- |
| Email address (staff sign-in) | Yes | Yes | App functionality |
| Device ID (push token) | Yes | Yes | App functionality |
| Crash data | Only if Sentry is turned on | No | App functionality |
| Tracking | No | | |

Export compliance is declared in the app (`usesNonExemptEncryption: false`: HTTPS only).

## 5. Build and ship

```sh
cd apps/mobile
APP_DISTRIBUTION=beeper npx eas-cli build --profile production --platform ios
APP_DISTRIBUTION=beeper npx eas-cli submit --profile production --platform ios --latest
```

The build goes to TestFlight first (minutes for internal testers), then to review from App
Store Connect (typically 1–2 days). JS-only fixes after launch ship with
`APP_DISTRIBUTION=beeper npx eas-cli update --channel production`.

Android: `--platform android` with a Google Play service account; Play's internal track is the
fastest way to get it onto Beeper staff phones.

## 6. Smoke test before submitting

On a TestFlight build against production:

1. Pair by QR from **/admin/admin_native_devices**.
1. Place a test order on beeper.buzz: a "New order" notification arrives; tapping it opens the order.
1. Home shows today's sales; Orders filters and order detail load.
1. Sign the device out in Spree admin: the app's next request returns it to sign-in.
