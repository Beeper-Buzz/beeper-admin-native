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
- **App version gate.** Require a minimum version of the app, or recommend a newer one, from Spree admin.
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

Then open **/admin/admin_native_devices** (the Admin app page) in Spree admin and tap **Pair a device**.

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
  c.ios_bundle_id = 'com.example.admin' # App Store check for app versions; nil skips it
  c.app_version_gate = true # false turns the app version gate off
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
| `GET app_version`                              | none                          | The app version gate for `platform` (and `version`); see "App version gate" below                                                                                                                                              |
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
  r.singular 'Push notification'      # "New push notification"; default: label.singularize
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
  r.field :target_user_id, :reference, resource: 'spree_users'
  r.actions destroy: false            # create / update / destroy switches
  r.action :deliver, label: 'Send now', confirm: 'Send to every subscriber?',
                     if: ->(n) { n.status == 'draft' } do |notification, admin|
    PushNotifications::Deliver.call(notification, sent_by: admin)
    'Sending.'
  end
end
```

1. **Fields** come from the table with `fields :auto` (strings, text, numbers, booleans, dates,
   JSON, Rails enums), then `field` overrides or adds (`:reference`, `:image`, `:file`, `:url`,
   `:color`, `:enum`…). Columns that look secret (password, token, secret, digest, encrypted,
   api_key, salt, otp, private_key, credentials, stream_key, signed_payload, jwt, cvv) are never
   read or written, whatever the registration says. `id`, timestamps and `lock_version` are
   read-only.
1. **Writes** accept only declared, non-read-only fields, through the model's own validations.
1. **Actions** run the block with the record and the signed-in admin; a returned string is shown.
1. The capabilities endpoint announces `admin.resources` when any type the host registered is
   available (the built-in lookups alone don't count).

The sections below are new in 0.5. Everything is additive: a 0.4 app works against a 0.5 gem.

### Singular labels and hidden types

```ruby
r.singular 'Menu item'   # manifest `singular`
r.hidden                 # manifest `hidden: true`: not in More, still listable (a reference target)
```

### Defaults and required fields

```ruby
r.field :active, default: true      # prefills the create form (manifest field `default`)
```

Auto fields take the column default, cast (not for `id`, timestamps or read-only fields). A field
is `required` when its column is `NOT NULL` without a default, when the model has a presence
validator for it without `if`, `unless` or `on`, or when it is the foreign key of a non-optional
`belongs_to` (a presence validator on `country` marks `country_id`). `required: false` on a field
overrides the inference.

### Per-record rules

```ruby
r.editable_if ->(post) { post.author_locked_at.nil? }
r.deletable_if ->(zone) { zone.zone_members.none? }
```

Every record carries `can: { update:, destroy: }`: the type's switches and the record's rule. A
refused update or delete is a 403 `not_allowed`.

### Save hooks

```ruby
r.before_save do |record, admin, op|      # op is :create or :update; values are assigned
  record.errors.add(:alt, "Alt text can't be blank") if record.alt.blank?   # stops with 422
end
r.after_save do |record, admin, op|       # after a successful save, in the same transaction
  AuditLog.create!(record: record, by: admin, op: op)   # raising or adding errors rolls back
end
```

Errors added in `before_save` come back next to the model's own validation errors.

### Action inputs and removed records

```ruby
r.action :rename, label: 'Rename',
                  inputs: [{ name: :new_name, type: :string, required: true, label: 'New name' }] do |reason, admin, input|
  reason.update!(name: input[:new_name])
  'Renamed.'
end
r.action :discard, label: 'Discard', confirm: 'Delete this zone?', destructive: true do |zone, _admin|
  zone.destroy!
  { message: 'Discarded.', removed: true }
end
```

1. `inputs` are field specs (`name`, `type`, `label`, `required`, `options`, `resource`, `hint`,
   `default`) the app asks for before running the action; the manifest lists them as field JSON.
1. The block gets a third argument, the inputs cast by type (integer, decimal as `BigDecimal`,
   boolean, date, datetime, json; reference as an id string) with symbol keys. Every declared
   input is there (nil or its default when not sent); unknown keys are ignored. Blocks with two
   parameters work as before.
1. A missing required input is a 422 with `fields: { new_name: ["can't be blank"] }`, a value
   that can't be cast a 422 with `is invalid`.
1. Return a string (the message) or `{ message:, removed: true }`. When `removed` is set, or the
   record no longer exists or is no longer in the type's scope after the run, the response is
   `{ data: null, removed: true, message }`.

### Filters

```ruby
r.filter :status, %w[draft sent]      # type 'enum' with these options
r.filter :active                      # enum and boolean fields offer their own options
r.filter :country_id                  # on a reference field: type 'reference', `resource`; value is an id
r.filter :locked_at, :presence        # type 'presence', options set / unset: filter[locked_at]=set is IS NOT NULL
r.filter :created_at, :date_range     # filter[created_at][from] / [to]: ISO dates, days included, store time zone
```

### Uploads, images and files

```ruby
r.field :poster, :image               # value: the URL; write a signed_id to attach, null to remove
r.field :manual, :file                # value: { url, filename, content_type, byte_size } or null
```

Image and file fields are writable unless `readonly: true`. Upload first with
`POST resources/uploads` (multipart `file`, at most 25 MB, 413 above), then send the returned
`signed_id` as the field's value. `null` removes the attachment, which ActiveStorage purges when
the save commits. Blobs uploaded but never attached stay unattached; purge them as you would any
unattached blob.

### Version conflicts

Every record carries `version`: `lock_version` when the table has one, else `updated_at` (ISO 8601
with microseconds). Send it back with an update and the gem refuses the save when the record
changed since: 409 `{ error: { code: 'conflict', message: 'Someone else changed this. Reload to see their changes.' } }`.

### Extending an inherited type

```ruby
# A fork, or an extension, in any load order:
SpreeAdminNative.resources.configure('menu_items') do |r|
  r.field :badge, :string
  r.search :name, :url, :badge
end
```

The block runs now if the type is registered, and again whenever it is (re)registered, for
example by a `to_prepare` hook on each reload. The same block (by source location) given again
replaces itself. This replaces 0.4-era load hooks such as
`ActiveSupport.on_load(:spree_admin_native_resource)`.

### Built-in lookups

So host references can point at core Spree records without registering them, the gem provides
hidden, read-only types, used only when the host hasn't registered the key:

| Key              | Model              | Title    | Subtitle       | Search            |
| ---------------- | ------------------ | -------- | -------------- | ----------------- |
| `spree_users`    | `Spree.user_class` | `email`  |                | `email`           |
| `spree_products` | `Spree::Product`   | `name`   | `slug`         | `name`, `slug`    |
| `spree_variants` | `Spree::Variant`   | `sku`    | product's name | `sku`             |
| `spree_orders`   | `Spree::Order`     | `number` | `email`        | `number`, `email` |

Their fields are the title and subtitle columns and `created_at`. Register the same key to replace one (before
or after the gem loads, either way yours wins), or `SpreeAdminNative.resources.unregister('spree_orders')`
to remove it.

### Records and errors

A record is `{ id, title, subtitle, values, actions, can: { update, destroy }, version }`. Reference
values are `{ id, title }`, loaded with one query per reference field per page. Validation errors
come back as `{ error: { code: 'invalid', message, fields } }`; an association's errors (`country`)
are reported under its foreign key (`country_id`) when that is a field, and `base` stays `base`.

| Endpoint                                                                                                 | What                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET resources`                                                                                          | `{ data: [types], meta: { gem_version } }`                                                |
| `GET resources/:key`                                                                                     | `q`, `filter[name]` (or `[from]` / `[to]`), `page`, `per_page`                            |
| `GET resources/:key/:id`, `POST resources/:key`, `PATCH resources/:key/:id`, `DELETE resources/:key/:id` | `{ values: {…} }`; `PATCH` also takes `version`                                           |
| `POST resources/:key/:id/actions/:action`                                                                | `{ input: {…} }`: `{ data, message }`, or `{ data: null, removed: true, message }`        |
| `POST resources/uploads`                                                                                 | Multipart `file`: `{ data: { signed_id, filename, content_type, byte_size, url } }` (201) |

All admin-only. With no database (asset precompile), types are simply unavailable instead of
raising.

## App version gate

New in 0.6. A store can require a minimum version of the admin app, and recommend a newer one.
Below the minimum the app shows a full-screen Update required screen; below the recommended
version it asks, without forcing, with an Update available prompt. The settings belong to the
store, and a store that sets nothing has no gate.

### Admin page

The **App versions** section of the Admin app page (`/admin/admin_native_devices`) has a form
for iOS, Android and All. A platform without its own row uses the All row, and the table at the
top shows what each platform currently gets.

| Field                        | What                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| Minimum version              | `x.y.z`. Below it, the app can't be used until it's updated. `0.0.0` means no minimum. |
| Recommended version          | `x.y.z`, at or above the minimum. Below it, people are asked, not forced, to update.   |
| Update link                  | Where the Update button goes (App Store, TestFlight or Play link); `https` only        |
| Allow ahead of the App Store | iOS and All only: skips the App Store check, for a version in review or on TestFlight  |

Leave a version blank for none. Clearing both versions and the link deletes the platform's row.

**App Store check.** When `ios_bundle_id` is set, the iOS and All versions can't be above the
version the App Store serves for it (`https://itunes.apple.com/lookup?bundleId=…`, 5 s timeout),
unless "Allow ahead of the App Store" is ticked. A failed lookup, or an app the App Store doesn't
list, counts as not live: the form says so and asks for the box. The check runs when a version
or the box changes, so editing only the link never needs the App Store. Android has no check.

### Endpoint

`GET /api/admin_native/v1/app_version?platform=ios&version=1.2.3` is public: an outdated app
must reach it before anyone signs in, and it reveals only version numbers and the store link.

```json
{
  "data": {
    "minimum_version": "1.0.0",
    "recommended_version": "1.1.0",
    "update_url": "https://apps.apple.com/app/id123",
    "update_required": true,
    "update_recommended": true
  }
}
```

1. `platform` is `ios` or `android`; any other value (or none) reads the All row.
1. The fields are null when nothing is set.
1. `update_required` and `update_recommended` are computed only when `version` parses: `1.2` is
   `1.2.0`, and prerelease and build tags are dropped (`1.2.3-beta.1` is `1.2.3`). Otherwise both
   are false and the app compares versions itself. A minimum of `0.0.0` never requires an update.
1. It is 404 when the gate is off.

### Capability and configuration

The capabilities response lists `app.versionGate` when the gate is on and its table exists, so the
app only asks stores that have the endpoint. `c.app_version_gate = false` turns off the
capability, the endpoint and the admin section; `c.ios_bundle_id` turns on the App Store check.
The table, `spree_admin_native_app_versions`, comes with the gem's migrations
(`railties:install:migrations FROM=spree_admin_native`, then `db:migrate`).

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
