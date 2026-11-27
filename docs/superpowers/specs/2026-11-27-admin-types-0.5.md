# Admin types 0.5

Companion gem 0.5 closes the gaps hosts and the app hit with 0.4's host-described admin types.
Everything is additive: a 0.4 app keeps working against a 0.5 gem, and a 0.5 app against a 0.4
gem (it treats every new key as absent).

## DSL additions

| DSL | Manifest / record | Meaning |
| --- | --- | --- |
| `r.singular 'Menu item'` | type `singular` | Default `label.singularize`. "New menu item" |
| `r.hidden` | type `hidden: true` | Not listed in More; still listable, so it can be a reference target |
| `field …, default: v` | field `default` | Prefills the create form. Auto fields take the column default (cast; not for id or timestamps) |
| (auto) | field `required` | Also true for a presence validator without `if`/`unless`/`on`, and for the foreign key of a non-optional `belongs_to` |
| `r.editable_if ->(rec) { … }` | record `can.update` | false: update refused with 403 `not_allowed` |
| `r.deletable_if ->(rec) { … }` | record `can.destroy` | false: delete refused with 403 `not_allowed` |
| `r.before_save { \|rec, admin, op\| }` | | `op` is `:create` or `:update`; runs after values are assigned. Adding to `rec.errors` aborts with 422 |
| `r.after_save { \|rec, admin, op\| }` | | Runs after a successful save, inside the same transaction |
| `r.action …, inputs: [{ name: :note, type: :text, required: true, label: 'Reason' }]` | action `inputs` (field JSON) | The block gets a third argument, the cast input hash (symbol keys). Blocks with two parameters still work |
| `r.filter :country_id` on a reference field | filter `type: 'reference'`, `resource` | Value is an id |
| `r.filter :locked_at, :presence` | filter `type: 'presence'`, `options: ['set', 'unset']` | `filter[locked_at]=set` is `IS NOT NULL` |
| `r.filter :created_at, :date_range` | filter `type: 'date_range'` | `filter[created_at][from]` / `[to]`, ISO dates, inclusive days in the store's time zone |
| `r.filter :status, %w[a b]` or enum/boolean | filter `type: 'enum'`, `options` | As in 0.4 |
| `SpreeAdminNative.resources.configure('menu_items') { \|r\| … }` | | Runs now if the type is registered and again whenever it is (re)registered, so a fork can extend an inherited type in any load order |

Every record (`present`) also carries `can: { update:, destroy: }` (the type's switches AND the
record's rule) and `version` (`lock_version` when the table has one, else `updated_at` as ISO 8601
with microseconds, else omitted).

## API changes

1. `GET resources` returns `{ data: [...], meta: { gem_version: '0.5.0' } }`.
1. `PATCH resources/:key/:id` accepts `version`. When present and different from the record's
   current version: 409 `{ error: { code: 'conflict', message: 'Someone else changed this. Reload to see their changes.' } }`.
1. `POST …/actions/:action_key` accepts `{ input: { … } }`. Inputs are cast by type (integer,
   decimal as BigDecimal, boolean, date, datetime, json; reference as id string). A missing
   required input: 422 `{ error: { code: 'invalid', message, fields: { note: ["can't be blank"] } } }`.
   An unknown input key is ignored.
1. An action's block may return a String (message) or a Hash `{ message:, removed: true }`. When
   `removed` is set, or the record no longer exists or is no longer in the type's relation after
   the run, the response is `{ data: null, removed: true, message }` (200).
1. `POST resources/uploads` (multipart `file`, admins only, 25 MB max, 413 above) creates an
   ActiveStorage blob and returns `{ data: { signed_id, filename, content_type, byte_size, url } }`.
   Works on Rails 6.0 (`create_after_upload!`) and 6.1+ (`create_and_upload!`).
1. Image fields are writable unless `readonly: true`: a value is a blob `signed_id` (attach) or
   `null` (purge). The read value stays the URL string, as in 0.4.
1. New field type `file`: same writes as `image`; read value
   `{ url, filename, content_type, byte_size }` or `null`.
1. Reference values in lists are preloaded: one query per reference field per page, not per row.
1. Validation errors on an association (`country`) are reported under its foreign key
   (`country_id`) when that is a field.
1. Errors keyed `base` stay `base`; the app shows them above the form.

## Built-in lookups

The gem registers hidden, read-only types when the host hasn't registered the key, so host
references can point at core Spree records without registering them:

| Key | Model | Title | Subtitle | Search |
| --- | --- | --- | --- | --- |
| `spree_users` | `Spree.user_class` | `email` | | `email` |
| `spree_products` | `Spree::Product` | `name` | `slug` | `name`, `slug` |
| `spree_variants` | `Spree::Variant` | `sku` | `product.name` via a method-title | `sku` |
| `spree_orders` | `Spree::Order` | `number` | `email` | `number`, `email` |

Fields are minimal (title, subtitle, created_at) and never include PII beyond what is listed.
A host overrides one by registering the same key, or removes it with `unregister`.

## Hardening

1. `SECRET` also matches `stream_key`, `signed_payload`, `jwt` and `cvv`.
1. `model_class` also rescues `ActiveRecord::ConnectionNotEstablished`, so calling `available?`
   with no database (asset precompile) returns false instead of raising.

## Demo types (Spree 4.2 test store)

`infra/spree/4.2/initializers/admin_native_demo_types.rb` adds, for the contract suite:

1. `refund_reasons`: `singular 'Refund reason'`, `field :active, default: true`, and a `rename`
   action with `inputs: [{ name: :new_name, type: :string, required: true, label: 'New name' }]`
   returning `'Renamed.'`.
1. `zones`: `r.filter :description, :presence`, `r.filter :created_at, :date_range`, a `discard`
   action (`destructive: true`, `confirm:`) that destroys the zone and returns
   `{ message: 'Discarded.', removed: true }`, and `deletable_if ->(z) { z.zone_members.none? }`.
1. `states`: `r.filter :country_id` (reference to `countries`).
1. `product_images` over `Spree::Image`: `create: false`, `destroy: false`, fields `alt`
   (string) and `attachment` (image, writable), `viewable_id` read-only, `editable_if` always
   true; `before_save` refuses an empty alt with "Alt text can't be blank" on `alt`.
1. `option_types` over `Spree::OptionType` with a `configure` call later in the file that adds a
   `presentation` search, proving `configure` works after registration.
