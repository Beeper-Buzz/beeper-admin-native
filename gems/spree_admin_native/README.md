# spree_admin_native

The optional companion gem for [Spree Admin Native](https://github.com/1instinct/spree-admin-native),
the open-source mobile admin app for Spree. The app works without it; the gem adds:

- **QR device pairing.** Sign the app in by scanning a code in Spree admin instead of pasting an
  API key. Each device gets its own token, which you can sign out at any time.
- **New order notifications.** A push to every paired device when an order is placed.
- **Home screen numbers.** Today's sales, orders to fulfil, payments due and low stock in one request.
- **A store-wide photo list.** Every product image in one list, searchable by product, with the ones
  missing alt text a filter away (Spree 4.x's API only lists one product's images at a time).
- **Order creation helpers (Spree 4.2–4.3).** Card-free payment methods and draft deletion for
  orders the merchant creates in the app.
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
  c.permit_bigdecimal_yaml = true # see "Decimal settings" below
end

# Extensions announce features the app can light up:
SpreeAdminNative.register_capability('beeper.moderation')
```

Push messages go through the Expo Push API. Forks of the app built with their own Expo project
work the same way: each device sends the token for the app it is running.

## API

All under `/api/admin_native/v1`.

| Endpoint                                       | Auth                          | What                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET capabilities`                             | none                          | API families, extra capabilities and sign-in methods, store name and currency                                                                                                                                                  |
| `POST pairings/exchange`                       | one-time code                 | `{code, device_name, platform}` → `{token, device, user}`                                                                                                                                                                      |
| `GET summary`                                  | device token or admin API key | Today's orders and sales, orders to fulfil, payments due, low-stock variants                                                                                                                                                   |
| `GET low_stock`                                | device token or admin API key | Products with low-stock variants, lowest first: `{data: [{product_id, low_variants, lowest_on_hand}], meta: {total_count, threshold}}`                                                                                         |
| `GET media`                                    | device token or admin API key | Every product image, newest first: `q` (product name or SKU), `missing_alt`, `page`, `per_page` → `{data: [{id, product_id, product_name, variant_id, alt, position, mini_url, product_url, large_url}], meta: {total_count}}` |
| `GET devices`                                  | device token or admin API key | Your paired devices                                                                                                                                                                                                            |
| `PATCH devices/current`                        | device token                  | `{push_token, push_enabled}`                                                                                                                                                                                                   |
| `DELETE devices/:id`                           | device token or admin API key | Sign a device out                                                                                                                                                                                                              |
| `GET refund_reasons`                           | device token or admin API key | Active refund reasons                                                                                                                                                                                                          |
| `POST orders/:number/payments/:number/refunds` | device token or admin API key | `{amount, reason_id?}` → refund through the payment's gateway (default reason: Return processing)                                                                                                                              |
| `GET promotions`                               | device token or admin API key | `q`, `status` (`active`, `scheduled`, `expired`), `page`, `per_page`                                                                                                                                                           |
| `GET promotions/:id`                           | device token or admin API key | One promotion                                                                                                                                                                                                                  |
| `POST promotions`                              | device token or admin API key | `{name, code?, description?, starts_at?, expires_at?, usage_limit?, discount: {type: percent\|fixed, amount}}`                                                                                                                 |
| `PATCH promotions/:id`                         | device token or admin API key | Any of those fields; `discount` only on promotions with a single order discount                                                                                                                                                |
| Endpoint                                       | Auth                          | What                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------                                                                                         |
| `GET capabilities`                             | none                          | API families, extra capabilities and sign-in methods, store name and currency                                                                                                                                                  |
| `POST pairings/exchange`                       | one-time code                 | `{code, device_name, platform}` → `{token, device, user}`                                                                                                                                                                      |
| `GET summary`                                  | device token or admin API key | Today's orders and sales, orders to fulfil, payments due, low-stock variants                                                                                                                                                   |
| `GET low_stock`                                | device token or admin API key | Products with low-stock variants, lowest first: `{data: [{product_id, low_variants, lowest_on_hand}], meta: {total_count, threshold}}`                                                                                         |
| `GET devices`                                  | device token or admin API key | Your paired devices                                                                                                                                                                                                            |
| `PATCH devices/current`                        | device token                  | `{push_token, push_enabled}`                                                                                                                                                                                                   |
| `DELETE devices/:id`                           | device token or admin API key | Sign a device out                                                                                                                                                                                                              |
| `GET refund_reasons`                           | device token or admin API key | Active refund reasons                                                                                                                                                                                                          |
| `POST orders/:number/payments/:number/refunds` | device token or admin API key | `{amount, reason_id?}` → refund through the payment's gateway (default reason: Return processing)                                                                                                                              |
| `GET promotions`                               | device token or admin API key | `q`, `status` (`active`, `scheduled`, `expired`), `page`, `per_page`                                                                                                                                                           |
| `GET promotions/:id`                           | device token or admin API key | One promotion                                                                                                                                                                                                                  |
| `POST promotions`                              | device token or admin API key | `{name, code?, description?, starts_at?, expires_at?, usage_limit?, discount: {type: percent\|fixed, amount}}`                                                                                                                 |
| `PATCH promotions/:id`                         | device token or admin API key | Any of those fields; `discount` only on promotions with a single order discount                                                                                                                                                |
| `GET payment_methods`                          | device token or admin API key | Payment methods that need no card (active, offered in the back office, no source): `{data: [{id, name, description}]}`                                                                                                         |
| `DELETE orders/:number`                        | device token or admin API key | Delete a draft order a staff member started; placed orders and shoppers' carts are refused (422)                                                                                                                               |

Send the token as `X-Spree-Token` (or `Authorization: Bearer`). Device tokens also work on Spree's
API v1 wherever an API key does.

"Low stock" means sellable variants (option variants, or the master of a product without
options) that track inventory, on live products, with stock summed across locations at or under
`low_stock_threshold`. The summary counts exactly the variants `low_stock` lists.

Refunds and promotions exist for Spree 4.2–4.3, whose API v1 has no refund action and only shows
one promotion. Order creation works on API v1 alone; the gem adds what v1 can't say or do: which
payment methods need no card (cash, check, bank transfer, including back-office-only ones) and
deleting a draft the merchant abandons (without the gem it is emptied, like an abandoned cart). The app uses Spree's own APIs for both on 4.4+. Promotions made elsewhere with
other rules or actions are listed and can be renamed, rescheduled or expired; their discount
stays as Spree admin set it (`editable_discount: false`).

### Decimal settings

Spree keeps calculator settings (discount percentages and amounts) in YAML columns, and Rails
6.1.6.1+ only reads permitted classes back from YAML. Decimal settings are `BigDecimal`, so on an
app that doesn't permit it a promotion's discount saves but can't be read, in Spree's admin too.
The gem adds `BigDecimal` to the app's permitted classes; set `permit_bigdecimal_yaml = false` if
you manage `yaml_column_permitted_classes` yourself.

## Admin types (host-described)

Apps built on Spree usually add their own admin data: menus, homepage sections, push
notifications, live streams, firmware… Describe them once and the mobile app shows generic list,
detail and edit screens for each, grouped under More, with no app release:

```ruby
# config/initializers/spree_admin_native_resources.rb
SpreeAdminNative.resources.register 'push_notifications' do |r|
  r.model 'PushNotification'          # left out when the class or table doesn't exist
  r.label 'Push notifications'
  r.group 'Engagement'                # More section
  r.icon 'bell'                       # SF Symbol name
  r.title :title
  r.subtitle :status
  r.list :title, :status, :sent_count
  r.search :title, :body
  r.filter :status, %w[draft sent failed]
  r.order :created_at, :desc
  r.fields :auto, readonly: %i[sent_count error_count errors_log]   # from the table's columns
  r.field :status, :enum, options: %w[draft sent failed], readonly: true
  r.field :target_user_id, :reference, resource: 'users'
  r.actions destroy: false            # create / update / destroy switches
  r.action :deliver, label: 'Send now', confirm: 'Send to every subscriber?',
                     if: ->(n) { n.status == 'draft' } do |notification, admin|
    PushNotifications::Deliver.call(notification, sent_by: admin)
    'Sending.'
  end
end
```

1. **Fields** come from the table with `fields :auto` (strings, text, numbers, booleans, dates,
   JSON, Rails enums), then `field` overrides or adds (`:reference`, `:image`, `:url`, `:color`,
   `:enum`…). Columns that look secret (password, token, secret, digest, encrypted, api_key, salt,
   otp, credentials) are never read or written, whatever the registration says. `id` and
   timestamps are read-only.
1. **Writes** accept only declared, non-read-only fields, through the model's own validations.
1. **Actions** run the block with the record and the signed-in admin; a returned string is shown.
1. The capabilities endpoint announces `admin.resources` when any type is available.

| Endpoint                                                                                                 | What                                    |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `GET resources`                                                                                          | Manifest of available types             |
| `GET resources/:key`                                                                                     | `q`, `filter[name]`, `page`, `per_page` |
| `GET resources/:key/:id`, `POST resources/:key`, `PATCH resources/:key/:id`, `DELETE resources/:key/:id` | `{values: {…}}`                         |
| `POST resources/:key/:id/actions/:action`                                                                | Runs a declared action                  |

All admin-only.

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
