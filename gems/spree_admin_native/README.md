# spree_admin_native

The optional companion gem for [Spree Admin Native](https://github.com/1instinct/spree-admin-native),
the open-source mobile admin app for Spree. The app works without it; the gem adds:

- **QR device pairing.** Sign the app in by scanning a code in Spree admin instead of pasting an
  API key. Each device gets its own token, which you can sign out at any time.
- **New order notifications.** A push to every paired device when an order is placed.
- **Home screen numbers.** Today's sales, orders to fulfil, payments due and low stock in one request.
- **Capabilities.** Tells the app what your store supports, including features your own
  extensions add.

| Spree     | Status                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------- |
| 4.2       | Proven in Docker (`infra/spree`)                                                                          |
| 4.3 – 5.x | Expected to work (same APIs); not yet in the test matrix                                                  |
| 6.x       | Not yet supported: Spree 6 has no Rails admin for the pairing page, and the app signs in with email there |

## Install

```ruby
# Gemfile
gem 'spree_admin_native', github: '1instinct/spree-admin-native', glob: 'gems/spree_admin_native/*.gemspec'
```

```sh
bundle install
bin/rails railties:install:migrations FROM=spree_admin_native
bin/rails db:migrate
```

Then open **/admin/admin_native/devices** in Spree admin and tap **Pair a device**.

For servers without a browser session (or for scripts and tests):

```sh
bin/rails "spree_admin_native:pairing_code[admin@example.com]"
```

## Configuration

```ruby
# config/initializers/spree_admin_native.rb
SpreeAdminNative.configure do |c|
  c.expo_access_token = ENV['SPREE_ADMIN_NATIVE_EXPO_ACCESS_TOKEN'] # if your Expo project enforces push security
  c.low_stock_threshold = 2
  c.pairing_ttl = 10.minutes
  c.expose_versions = true # Spree and gem versions on the public capabilities endpoint
end

# Extensions announce features the app can light up:
SpreeAdminNative.register_capability('beeper.moderation')
```

Push messages go through the Expo Push API. Forks of the app built with their own Expo project
work the same way: each device sends the token for the app it is running.

## API

All under `/api/admin_native/v1`.

| Endpoint                 | Auth                          | What                                                                          |
| ------------------------ | ----------------------------- | ----------------------------------------------------------------------------- |
| `GET capabilities`       | none                          | API families, extra capabilities and sign-in methods, store name and currency |
| `POST pairings/exchange` | one-time code                 | `{code, device_name, platform}` → `{token, device, user}`                     |
| `GET summary`            | device token or admin API key | Today's orders and sales, orders to fulfil, payments due, low-stock variants  |
| `GET devices`            | device token or admin API key | Your paired devices                                                           |
| `PATCH devices/current`  | device token                  | `{push_token, push_enabled}`                                                  |
| `DELETE devices/:id`     | device token or admin API key | Sign a device out                                                             |

Send the token as `X-Spree-Token` (or `Authorization: Bearer`). Device tokens also work on Spree's
API v1 wherever an API key does.

## Security

- Pairing codes and device tokens are stored only as SHA-256 digests.
- Codes are single use, expire after 10 minutes and carry about 59 bits of randomness.
- Signing a device out takes effect on its next request.
- The capabilities endpoint is public and reports the Spree version unless `expose_versions` is off.

## Tests

The integration test runs inside a real Spree app and rolls back everything it changes:

```sh
docker compose -f infra/spree/docker-compose.yml exec spree42 \
  bin/rails runner /gems/spree_admin_native/test/integration_test.rb
```
