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
- **Admin types.** Your own admin data (menus, homepage sections…) in generic screens, including
  nested trees you reorder (a menu builder) and link fields.
- **Inbox.** Conversations with customers answered from the app, through an adapter over your chat
  data, with a push when a customer writes.
- **Carts and visitors.** Shoppers' carts (and the abandoned ones) for every store, and who is on
  the storefront now through an adapter over your session tracking.
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
  c.inbox_adapter = 'Chat::AdminNativeInbox' # see "Inbox"; unset, no inbox
  c.inbox_push_throttle = 120 # seconds between inbox pushes for one conversation
  c.visitors_adapter = 'Visits::AdminNativeVisitors' # see "Carts and visitors"; unset, no visitors
  c.active_cart_minutes = 60 # the Home summary's active_carts window
  c.cache_store = nil # the inbox push throttle's store; nil uses Rails.cache
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

| Key              | Model              | Title         | Subtitle       | Search            |
| ---------------- | ------------------ | ------------- | -------------- | ----------------- |
| `spree_users`    | `Spree.user_class` | `email`       |                | `email`           |
| `spree_products` | `Spree::Product`   | `name`        | `slug`         | `name`, `slug`    |
| `spree_variants` | `Spree::Variant`   | `sku`         | product's name | `sku`             |
| `spree_orders`   | `Spree::Order`     | `number`      | `email`        | `number`, `email` |
| `spree_taxons`   | `Spree::Taxon`     | `pretty_name` | `permalink`    | `name`            |

Their fields are the title and subtitle columns and `created_at` (`spree_taxons`, new in 0.7: `name`, `permalink`, `created_at`). Register the same key to replace one (before
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

## Tree views

New in 0.7. A type whose records nest (menu items, categories) can declare a tree; the app then
shows a nested list you reorder, indent and outdent instead of the flat list.

```ruby
SpreeAdminNative.resources.register 'menu_locations' do |r|
  r.model 'MenuLocation'
  r.hidden                 # managed from the tree screen; hidden types still accept CRUD
  r.title :title
  r.fields :auto
end

SpreeAdminNative.resources.register 'menu_items' do |r|
  r.model 'MenuItem'
  r.title :name
  r.fields :auto
  r.field :menu_location_id, :reference, resource: 'menu_locations', label: 'Menu'
  r.view :tree, parent: :parent_id, position: :position, group: :menu_location_id
end
```

1. `parent` is the self-referencing column (default `parent_id`), `position` an integer column
   ordered ascending among siblings (default `position`).
1. `group` (optional) is a `:reference` field naming its `resource`; its values split the records
   into separate trees, one per menu location here.
1. The manifest gains
   `view: { type: 'tree', parent: 'parent_id', position: 'position', group: 'menu_location_id' }`
   (`group` left out when there is none). A view whose columns are missing, or whose group isn't
   a reference field naming its resource, is left out of the manifest and logged.

| Endpoint                             | What                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `GET resources/:key/tree?group=<id>` | `{ data: [{ ...record, children: [...] }], meta: { group: { id, title } \| null } }`                    |
| `PATCH resources/:key/tree`          | `{ group: <id\|null>, nodes: [{ id, parent_id, position }] }`: applies every move, returns the new tree |

1. **GET** returns one group's records (or the whole table without `group`) as records nested in
   `children`. Siblings are ordered by position, then (for a nested set) `lft`, then id. A record
   whose parent isn't in the set is a root. Up to 2000 records; above that it is 422 `too_large`.
   An unknown group is 404.
1. **PATCH** applies the moves in one transaction, holding row locks on the group. Each node gets
   its new parent and is placed at `position` among its new siblings (items that didn't move keep
   their order; a missing or too-large position puts the item last). Then every parent's children
   in the group are renumbered 0..n. Only rows whose parent or position changed are written,
   with `update_columns` (and `updated_at`, and `lock_version` when the table has one): the
   model's validations, callbacks and the type's save hooks don't run for moves.
1. **Refusals** change nothing:

   | Status | `code`          | When                                                                                     |
   | ------ | --------------- | ---------------------------------------------------------------------------------------- |
   | 422    | `cycle`         | A node would end up under itself or one of its descendants                               |
   | 422    | `outside_group` | A node or its new parent isn't in `group`, or a parent is in another group than the node |
   | 403    | `not_allowed`   | `update` is switched off, or `editable_if` refuses a node that moves                     |
   | 422    | `invalid`       | `nodes` isn't a list, a node has no id or a non-integer position, or an id is repeated   |
   | 422    | `too_large`     | The group has more than 2000 records                                                     |
   | 404    | `not_found`     | The type has no tree view, or the group doesn't exist                                    |

1. **Nested sets.** For an awesome_nested_set model (`Spree::Taxon`), the gem renumbers `lft`,
   `rgt` and `depth` after the moves, the way `rebuild!` does, but taking this tree's siblings in
   position order (`rebuild!` keeps the old `lft` order and would undo a reorder). Records outside
   the tree keep their order, so `Spree::Taxon.valid?` holds and `taxon.children` agrees with the
   app. Nothing else about the record changes: Spree's taxon permalinks aren't regenerated.

### Link fields

A link stores a URL or a reference to a record (a product, a taxon, a page) in host columns:

```ruby
r.field :link, :link, label: 'Links to', url: :url, kind: :item_class, id: :item_id,
                      kinds: { 'product' => 'spree_products', 'taxon' => 'spree_taxons', 'page' => 'pages' }
```

1. The value is `{ kind: 'url', url }` or `{ kind, id, title }` (the title of the record in the
   kind's type, loaded with one query per kind per page). Nothing set is `null`.
1. Writes take the same shape (`id` may also be `{ id }`); `null` clears the three columns. The kind
   column stores the kind's name (`url`, `product`…). A URL clears the id column and a record
   clears the URL column. An unknown kind, a missing URL or id, or an id that doesn't exist in
   the kind's type is a 422 on the field.
1. The manifest field has `type: 'link'`, `options` (the kinds, `url` first when a URL column is
   mapped) and `kinds: [{ kind: 'url' }, { kind: 'product', resource: 'spree_products' }…]`. Kinds
   whose type isn't available here are left out.
1. The mapped columns aren't listed as fields of their own unless you declare them.
1. A stored kind the link doesn't know (say an old CSS class in `item_class`) reads as the URL
   when there is one, else `null`.

The built-in `spree_taxons` lookup (title `pretty_name`, subtitle `permalink`, search `name`)
makes `taxon` links work without registering taxons.

## Inbox

New in 0.7. Conversations with customers, kept by the host (web chat, email…) and answered from
the app. The gem owns the API, the shapes and the push; the host plugs in an adapter. The store
announces the `inbox` capability when `inbox_adapter` is set and its `available?` is true.

```ruby
SpreeAdminNative.configure do |c|
  c.inbox_adapter = 'Chat::AdminNativeInbox'   # an instance, a class or a class name (reload-safe)
  c.inbox_push_throttle = 120                   # seconds between pushes for one conversation
end
```

All admin only, under `/api/admin_native/v1/inbox`, with the same auth as the rest of the API:

| Endpoint                                                                | What                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET conversations?status=&assignee=&q=&page=&per_page=&updated_since=` | `{ data: [conversation], meta: { page, per_page, total_count } }`, newest activity first |
| `GET conversations/:id`                                                 | `{ data: conversation + customer_context }`                                              |
| `GET conversations/:id/messages?before=&after=&limit=`                  | `{ data: [message], meta: { limit } }`, oldest first; limit 50 by default, 200 at most   |
| `POST conversations/:id/messages`                                       | `{ body, attachments?: [signed_id], note? }` → 201 `{ data: message }`                   |
| `PATCH conversations/:id`                                               | `{ status?, assignee_id?, snoozed_until? }` → `{ data: conversation }`                   |
| `POST conversations/:id/read`                                           | Marks inbound messages read → `{ data: conversation }`                                   |
| `GET summary`                                                           | `{ data: { open, unassigned, unread } }`, the same keys repeated at the top level        |

1. `status` is `open` (default), `snoozed`, `closed` or `all`; `assignee` is `any` (default), `me`
   or `unassigned`; `updated_since` is ISO 8601 (for polling); `per_page` is 25 by default, 100
   at most. Other values are 422 `invalid` with `fields`.
1. A reply needs a body (at most 4000 characters) or attachments, which are `signed_id`s from
   `POST resources/uploads`. `note: true` stores an internal note, never sent to the customer.
1. `PATCH` passes only the keys sent: `status` (`open`, `snoozed`, `closed`), `assignee_id` (a
   string, or null to unassign), `snoozed_until` (a `Time`, or null).

Shapes (ids are strings, times ISO 8601, money strings with two decimals):

```json
// conversation
{ "id": "12", "status": "open", "channel": "web", "subject": null,
  "customer": { "name": "Ada", "email": "ada@example.com", "avatar_url": null, "contact_id": "7", "user_id": "3" },
  "assignee": { "id": "1", "email": "staff@example.com" }, "unread": 2,
  "last_message": { "body": "Is this in stock?", "direction": "inbound", "at": "2026-11-28T10:00:00Z" },
  "updated_at": "2026-11-28T10:00:00Z", "snoozed_until": null }
// message
{ "id": "301", "direction": "inbound", "body": "Is this in stock?", "channel": "web",
  "author": { "kind": "customer", "name": "Ada" },
  "attachments": [{ "url": "https://…", "filename": "photo.jpg", "content_type": "image/jpeg" }],
  "created_at": "2026-11-28T10:00:00Z", "read_at": null, "delivery": null }
// customer_context
{ "contact": { "id": "7", "name": "Ada", "email": "ada@example.com", "phone": null },
  "user": { "id": "3", "email": "ada@example.com" },
  "session": { "id": "55", "current_url": "/products/mug", "last_seen_at": "…", "online": true },
  "cart": { "order_number": "R123", "item_count": 2, "total": "18.50", "currency": "USD",
            "items": [{ "name": "Mug", "quantity": 2, "image_url": null }] },
  "recent_orders": [{ "number": "R100", "state": "complete", "total": "42.00", "completed_at": "…" }] }
```

`direction` is `inbound`, `outbound` or `note`; `author.kind` is `customer`, `staff` or `system`
(inferred from the direction when missing); `delivery` is `sent`, `delivered`, `failed` or null.
`session.online` is the adapter's, or "seen within the last 2 minutes".

### The inbox adapter

Subclass `SpreeAdminNative::Inbox::Adapter`. Every method returns plain hashes, with string or
symbol keys, in the shapes above. The gem checks the required keys (conversation `id` and
`status`; message `id`, `direction` and `created_at`; summary `open`, `unassigned` and `unread`)
and the allowed values, and serializes only the keys above.

| Method                                                   | Returns                                                                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `available?`                                             | Whether the inbox is on (true unless overridden)                                                                                                               |
| `conversations(filters)`                                 | `{ records: [conversation], total: }`; filters are `{ status:, assignee:, q:, page:, per_page:, updated_since: (Time or nil), admin: }`                        |
| `conversation(id)`                                       | A conversation, or nil (404)                                                                                                                                   |
| `messages(conversation, before:, after:, limit:)`        | `[message]`, oldest first. `conversation` is the hash `conversation(id)` returned; extra messages are trimmed to `limit` (the newest, unless `after` is given) |
| `reply(conversation, admin, body:, attachments:, note:)` | The new message. Deliver it on the conversation's channel unless `note`                                                                                        |
| `update(conversation, admin, attrs)`                     | The conversation                                                                                                                                               |
| `mark_read(conversation, admin)`                         | The conversation, or anything else (the gem then reads it again)                                                                                               |
| `summary(admin)`                                         | `{ open:, unassigned:, unread: }`                                                                                                                              |
| `customer_context(conversation)`                         | `{ contact:, user:, session:, cart:, recent_orders: }`, any of them nil or empty                                                                               |

Errors: raise `SpreeAdminNative::AdapterInvalid` (or let `ActiveRecord::RecordInvalid` through) to
refuse what the app sent, which is a 422 `invalid` with the message. Anything else raised,
including `NotImplementedError` from a method you didn't write, and output missing a required key
or with an unknown value, is a 502 `{ error: { code: 'adapter_failed', message } }`, logged, with
no stack trace in the response. `ActiveRecord::RecordNotFound` is a 404.

```ruby
# app/services/chat/admin_native_inbox.rb (a host app)
module Chat
  class AdminNativeInbox < SpreeAdminNative::Inbox::Adapter
    def conversations(filters)
      scope = Conversation.all
      scope = scope.where(status: filters[:status]) unless filters[:status] == 'all'
      scope = scope.where(assignee_id: filters[:admin].id) if filters[:assignee] == 'me'
      scope = scope.where(assignee_id: nil) if filters[:assignee] == 'unassigned'
      scope = scope.search(filters[:q]) if filters[:q]
      scope = scope.where('updated_at > ?', filters[:updated_since]) if filters[:updated_since]
      page = scope.order(last_message_at: :desc).offset((filters[:page] - 1) * filters[:per_page]).limit(filters[:per_page])
      { records: page.map { |c| present(c) }, total: scope.count }
    end

    def conversation(id)
      record = Conversation.find_by(id: id)
      record && present(record)
    end

    def messages(conversation, before:, after:, limit:)
      scope = Message.where(conversation_id: conversation[:id])
      rows = if after then scope.where('id > ?', after).order(:id).limit(limit)
             elsif before then scope.where('id < ?', before).order(id: :desc).limit(limit).reverse
             else scope.order(id: :desc).limit(limit).reverse
             end
      rows.map { |m| present_message(m) }
    end

    def reply(conversation, admin, body:, attachments:, note:)
      message = Conversation.find(conversation[:id]).reply!(body, by: admin, note: note, attachments: attachments)
      present_message(message)
    end

    def update(conversation, admin, attrs)
      record = Conversation.find(conversation[:id])
      record.update!(attrs)
      present(record)
    end

    def mark_read(conversation, _admin)
      Conversation.find(conversation[:id]).mark_read_for_staff!
    end

    def summary(_admin)
      open = Conversation.where(status: 'open')
      { open: open.count, unassigned: open.where(assignee_id: nil).count, unread: open.where('staff_unread_count > 0').count }
    end

    def customer_context(conversation)
      contact = Conversation.find(conversation[:id]).contact
      { contact: { id: contact.id, name: contact.name, email: contact.email, phone: nil },
        user: contact.user && { id: contact.user.id, email: contact.user.email },
        session: nil, cart: nil, recent_orders: [] }
    end

    private

    def present(c)
      { id: c.id, status: c.status, channel: c.channel, subject: c.subject,
        customer: { name: c.contact.name, email: c.contact.email, contact_id: c.contact_id, user_id: c.contact.user_id },
        assignee: c.assignee && { id: c.assignee.id, email: c.assignee.email }, unread: c.staff_unread_count,
        last_message: c.last_message && { body: c.last_message.body, direction: c.last_message.direction, at: c.last_message.created_at },
        updated_at: c.updated_at, snoozed_until: c.snoozed_until }
    end

    def present_message(m)
      { id: m.id, direction: m.direction, body: m.body, channel: m.channel,
        author: { kind: m.inbound? ? 'customer' : 'staff', name: m.author_name }, attachments: [],
        created_at: m.created_at, read_at: m.read_at, delivery: m.delivery_status }
    end
  end
end
```

### Push for inbound messages

When a customer writes, the host calls (after the message is committed):

```ruby
SpreeAdminNative::Inbox.notify_inbound(conversation_hash, message_hash)
```

1. It pushes to every paired admin device through Expo, like new orders: the title is the
   customer's name (or email), the body the message squished and truncated to 140 characters,
   and the data `{ type: 'inbox', conversation_id: '12' }`.
1. It pushes at most once per conversation per `inbox_push_throttle` seconds (120). The throttle
   lives in `config.cache_store`, else `Rails.cache`, else (when `Rails.cache` is a null store) a
   memory store in the process. With several processes and no shared cache, each throttles alone.
1. It skips messages whose `direction` is given and isn't `inbound`, needs the conversation's
   `id`, and never raises: it returns true when a push was queued (`PushJob`, ActiveJob), false
   otherwise.

## Carts and visitors

New in 0.7.

### Carts (built in)

Every store announces `carts`. A cart is an incomplete order in the `cart`, `address`,
`delivery` or `payment` state with at least one line item. Drafts staff started for someone else
(created by an admin, for another user or none) are orders in progress, not carts, and are left
out.

| Endpoint                                                                   | What                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET carts?active_within=<minutes>&with_email=&abandoned=&page=&per_page=` | `{ data: [cart], meta: { page, per_page, total_count } }`, newest `updated_at` first |
| `GET carts/:number`                                                        | `{ data: cart }`; 404 for a placed order or one in another state                     |

```json
{
  "number": "R123456789",
  "state": "payment",
  "email": "ada@example.com",
  "user_id": "3",
  "item_count": 3,
  "total": "284.97",
  "currency": "USD",
  "updated_at": "2026-11-28T09:12:00Z",
  "abandoned": true,
  "items": [{ "name": "Mug", "variant_sku": "MUG-1", "quantity": 2, "image_url": "https://…" }]
}
```

1. `active_within` keeps carts updated in the last N minutes; `with_email=true|false` keeps carts
   with or without an email.
1. **Abandoned** carts have an email and haven't been updated for an hour or more. Each cart says
   so (`abandoned`), and `abandoned=true|false` filters by it.
1. `image_url` is the variant's first image (else its product's), in Spree's `small` rendition.
1. The Home summary's `active_carts` counts carts updated within `active_cart_minutes` (60).

### Visitors

Who is on the storefront right now needs the host's session tracking, through
`config.visitors_adapter` (like the inbox adapter). The store announces `visitors` when it is
set and available.

| Endpoint                         | What                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET visitors?online=true&page=` | `{ data: [session], meta: { page, per_page, total_count } }`                                                                     |
| `GET visitors/:id`               | `{ data: session + pages }`: `pages: [{ url, title, at }]`, the last 50, newest first                                            |
| `POST visitors/:id/conversation` | Starts or finds the conversation with that visitor: `{ data: { conversation_id } }`, `conversation_id` repeated at the top level |

```json
{
  "id": "55",
  "contact": { "id": "7", "name": "Ada", "email": "ada@example.com" },
  "user_id": "3",
  "current_url": "/products/mug",
  "current_title": "Mug",
  "referrer": "https://search.example.com",
  "utm": { "source": "news", "medium": "email", "campaign": "fall" },
  "device": "mobile",
  "country": "NL",
  "started_at": "…",
  "last_seen_at": "…",
  "online": true,
  "page_views": 4,
  "cart": { "order_number": "R123", "item_count": 2, "total": "18.50", "currency": "USD" },
  "conversation_id": "12"
}
```

`online` is the adapter's, or "seen within the last 2 minutes". `device` is `mobile`, `desktop`,
`tablet` or null. A session needs `id` and `last_seen_at`.

| Method                               | Returns                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `available?`                         | Whether tracking is on (true unless overridden)                                                                                  |
| `sessions(filters)`                  | `{ records: [session], total: }`, most recently seen first; filters are `{ online: true\|false\|nil, page:, per_page:, admin: }` |
| `session(id)`                        | A session with `pages`, or nil (404)                                                                                             |
| `start_conversation(session, admin)` | `{ conversation_id: }` (a bare id works too)                                                                                     |

Errors are handled as for the inbox adapter.

```ruby
class Visits::AdminNativeVisitors < SpreeAdminNative::Visitors::Adapter
  def sessions(filters)
    scope = VisitorSession.order(last_seen_at: :desc)
    scope = scope.where('last_seen_at >= ?', 2.minutes.ago) if filters[:online]
    page = scope.offset((filters[:page] - 1) * filters[:per_page]).limit(filters[:per_page])
    { records: page.map { |s| present(s) }, total: scope.count }
  end

  def session(id)
    record = VisitorSession.find_by(id: id)
    record && present(record).merge(pages: record.page_views.order(created_at: :desc).limit(50)
                                                 .map { |v| { url: v.url, title: v.title, at: v.created_at } })
  end

  def start_conversation(session, admin)
    { conversation_id: VisitorSession.find(session[:id]).conversation_for!(admin).id }
  end

  private

  def present(s)
    { id: s.id, contact: s.contact && { id: s.contact.id, name: s.contact.name, email: s.contact.email },
      user_id: s.contact&.user_id, current_url: s.current_url, current_title: s.current_title, referrer: s.referrer,
      utm: s.utm_source && { source: s.utm_source, medium: s.utm_medium, campaign: s.utm_campaign },
      device: s.device, country: s.country, started_at: s.started_at, last_seen_at: s.last_seen_at,
      page_views: s.page_views, cart: nil, conversation_id: s.conversation_id }
  end
end
```

### Home summary

`GET summary` gains `active_carts` (always) and `visitors_online` (the adapter's `total` for
`sessions(online: true)`) when the store has visitors. A failing visitors adapter leaves
`visitors_online` out instead of breaking Home.

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
