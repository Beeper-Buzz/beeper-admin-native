# Menus, inbox and visitors

Three record-by-record admin areas get replaced by tools built for the job:

1. **Menus.** Menu locations and menu items become one menu builder: location tabs and a nested
   tree you can reorder, indent and outdent, with inline add and edit.
1. **Inbox.** Threads and messages become a chat with customers.
   1. Customers write from a sticky widget on the storefront, and the conversation can continue
      by email.
   1. Other channels (SMS, WhatsApp, Instagram) plug in later through a channel interface.
1. **Visitors.** Contacts become what they were meant to be: who is on the storefront right now
   (a session tracker) and what is in their cart.
   1. Carts (incomplete orders with items) are core Spree, so every store gets them.
   1. Live sessions need the host's tracking.

Four pieces, each with a fixed contract:

| Piece | Repo | Contract it provides |
| --- | --- | --- |
| Companion gem 0.7 | `spree-admin-native` (`gems/spree_admin_native`) | §1 tree views, §2 inbox API and adapter, §3 visitors and carts API and adapter |
| Admin app | `spree-admin-native` (`apps/mobile`, `packages/*`) | Uses §1, §2 and §3 |
| Host backend | `1instinct/dna-admin` | §4 data model, §5 storefront chat and visit API, the §2 and §3 adapters, menu registration |
| Storefront widget | `1instinct/dna-frontend` | Uses §5 |

Every piece is generic: no product names. A store without the host pieces simply doesn't
announce the capability, and the app hides the feature.

## 1. Tree views (gem, admin types)

A registered type can declare that it is a tree:

```ruby
r.view :tree, parent: :parent_id, position: :position, group: :menu_location_id
```

1. **Options.**
   1. `parent`: the self-referencing column.
   1. `position`: an integer column, ordered ascending among siblings.
   1. `group` (optional): a reference field whose values split the records into separate trees,
      e.g. one menu per location. The group field must be a `:reference` field naming its
      `resource`.
1. **Manifest.** The type gains
   `view: { type: 'tree', parent: 'parent_id', position: 'position', group: 'menu_location_id' }`.
   Apps that don't know `view` keep the flat list.
1. **`GET resources/:key/tree?group=<id>`** returns the whole tree for one group (or the whole
   table without `group`), presented records nested:
   `{ data: [ { ...record, children: [ ... ] } ], meta: { group: { id, title } | null } }`. It is
   capped at 2000 records, with a 422 above that.
1. **`PATCH resources/:key/tree`** takes `{ group: <id|null>, nodes: [ { id, parent_id, position } ] }`
   and applies every move in one transaction.
   1. It is refused when it would make a cycle, when a node is outside the group, or when
      `update` is switched off or `editable_if` refuses a node (403).
   1. It renumbers positions 0..n per parent, then returns the new tree.
1. **Hiding the group type.** The group type (e.g. `menu_locations`) is usually registered with
   `r.hidden`, and the app manages it from the tree screen (add, rename and delete a location).
   `hidden` types still accept CRUD.

dna-admin registers `menu_items` with this view, grouped by `menu_location_id`, and hides
`menu_locations`. It also adds a link field: `item_class` and `item_id` become a typed link,
either a URL, a product, a taxon or a page.
1. The gem gains a field type `link` (manifest `type: 'link'`, value
   `{ kind: 'url'|'product'|'taxon'|'page', url?, id?, title? }`).
1. It maps to host columns through `r.field :link, :link, url: :url, kind: :item_class, id: :item_id, kinds: { 'product' => 'spree_products', 'taxon' => 'spree_taxons', 'page' => 'pages' }`.
1. The gem adds a built-in hidden lookup `spree_taxons` (title `pretty_name` or `name`, search
   `name`).

## 2. Inbox (gem API, host adapter)

Capability `inbox` when `SpreeAdminNative.config.inbox_adapter` is set and its `available?` is
true. All endpoints are admin only, under `/api/admin_native/v1/inbox`.

| Endpoint | Purpose |
| --- | --- |
| `GET conversations?status=open\|snoozed\|closed\|all&assignee=me\|unassigned\|any&q=&page=&per_page=&updated_since=` | List, newest activity first. `updated_since` (ISO) returns only conversations changed since, for polling |
| `GET conversations/:id` | One conversation plus `customer` context (below) |
| `GET conversations/:id/messages?before=<message id>&after=<message id>&limit=` | Messages oldest first. `after` is for polling, `before` for scrolling back. Limit 50 by default, 200 max |
| `POST conversations/:id/messages` | `{ body, attachments?: [signed_id] }`; the reply goes out on the conversation's channel |
| `PATCH conversations/:id` | `{ status?, assignee_id?, snoozed_until? }` |
| `POST conversations/:id/read` | Marks every inbound message read for staff |
| `GET summary` | `{ open, unassigned, unread }` for badges |

Shapes:

```json
// conversation
{ "id": "12", "status": "open", "channel": "web", "subject": null,
  "customer": { "name": "Ada", "email": "ada@example.com", "avatar_url": null, "contact_id": "7", "user_id": "3" },
  "assignee": { "id": "1", "email": "staff@example.com" } , "unread": 2,
  "last_message": { "body": "Is this in stock?", "direction": "inbound", "at": "2026-11-28T10:00:00Z" },
  "updated_at": "2026-11-28T10:00:00Z", "snoozed_until": null }
// message
{ "id": "301", "direction": "inbound|outbound|note", "body": "…", "channel": "web|email|…",
  "author": { "kind": "customer|staff|system", "name": "Ada" }, "attachments": [ { "url", "filename", "content_type" } ],
  "created_at": "…", "read_at": "…|null", "delivery": "sent|delivered|failed|null" }
// customer context (GET conversations/:id → data.customer_context)
{ "contact": { "id", "name", "email", "phone" }, "user": { "id", "email" } | null,
  "session": { "id", "current_url", "last_seen_at", "online": true } | null,
  "cart": { "order_number", "item_count", "total", "currency", "items": [ { "name", "quantity", "image_url" } ] } | null,
  "recent_orders": [ { "number", "state", "total", "completed_at" } ] }
```

1. `direction: 'note'` is an internal staff note, never sent to the customer. `POST messages`
   accepts `{ body, note: true }`.
1. **Adapter** (`SpreeAdminNative::Inbox::Adapter`, a base class with `NotImplementedError`
   defaults): `available?`, `conversations(filters)` returns
   `{ records:, total: }`, `conversation(id)`, `messages(conversation, before:, after:, limit:)`,
   `reply(conversation, admin, body:, attachments:, note:)`, `update(conversation, admin, attrs)`,
   `mark_read(conversation, admin)`, `summary(admin)` and `customer_context(conversation)`. They
   return plain hashes in the shapes above, and the gem serializes and validates them.
1. **Push.** The host calls `SpreeAdminNative::Inbox.notify_inbound(conversation_hash, message_hash)`
   when a customer writes.
   1. The gem pushes to every paired admin device through the existing Expo push.
   1. Title: the customer's name; body: the message, truncated to 140 characters; data
      `{ type: 'inbox', conversation_id }`.
   1. It is throttled to one push per conversation per 2 minutes.
1. Uploads for attachments reuse §0.5's `POST resources/uploads`.

## 3. Visitors and carts (gem)

1. **Carts** are built into the gem, for every Spree store. Capability `carts`.
   1. `GET /api/admin_native/v1/carts?active_within=<minutes>&with_email=true|false&page=` lists
      orders in the `cart`, `address`, `delivery` or `payment` state with at least one line
      item, newest `updated_at` first.
   1. Each cart: `{ number, state, email, user_id, item_count, total, currency, updated_at, items: [ { name, variant_sku, quantity, image_url } ] }`.
   1. `GET carts/:number` returns one cart with its line items.
   1. Abandoned carts are carts with an email that haven't been updated for 1 hour or more;
      the app filters them by `active_within` and `with_email`.
1. **Visitors** need a host adapter (`config.visitors_adapter`). Capability `visitors`.
   1. `GET /api/admin_native/v1/visitors?online=true&page=` returns sessions:
      `{ id, contact: { id, name, email } | null, user_id, current_url, current_title, referrer, utm: { source, medium, campaign } | null, device: 'mobile|desktop|tablet', country, started_at, last_seen_at, online, page_views, cart: { order_number, item_count, total, currency } | null, conversation_id }`.
   1. `online` means seen within the last 2 minutes.
   1. `GET visitors/:id` returns the same plus `pages: [ { url, title, at } ]` (the last 50).
   1. `POST visitors/:id/conversation` starts or returns the conversation with that visitor,
      giving `{ conversation_id }`. It's how staff message someone browsing.
   1. The adapter has `available?`, `sessions(filters)`, `session(id)` and
      `start_conversation(session, admin)`.
1. `GET /api/admin_native/v1/summary` (Home) gains `visitors_online` and `active_carts` when
   those capabilities are on.

## 4. Host data model (dna-admin)

The existing tables are kept and extended. Nothing reads the old messages, threads or contacts
API from a client, but the API stays working.

1. **`contacts`, a person.** Adds:
   1. `visitor_token` (string, unique, indexed): a random id the widget keeps in localStorage;
   1. `name`;
   1. `user_id` (`spree_users`; `actor_id` stays as an alias for old code);
   1. `last_seen_at`;
   1. `email_opt_in` (boolean).
1. **`visitor_sessions`, new:**
   1. `contact_id`, `token` (unique), `started_at`, `last_seen_at`;
   1. `current_url`, `current_title`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`;
   1. `user_agent`, `device`, `ip` (stored truncated to /24 or /48), `country` (from a header
      like `CF-IPCountry` when present);
   1. `order_id` (the cart), `page_views` (integer).
   1. A session ends after 30 minutes without a ping; the next ping starts a new one.
1. **`visitor_page_views`, new:** `visitor_session_id`, `url`, `title`, `created_at`. Keep 30
   days, pruned by a rake task.
1. **`thread_tables`, a conversation.** Adds:
   1. `contact_id`, `status` (open, snoozed or closed; default open), `channel` (web, email, …),
      `subject`;
   1. `assignee_id` (`spree_users`), `snoozed_until`, `last_message_at`;
   1. `staff_unread_count`, `customer_unread_count`;
   1. `visitor_session_id`.
1. **`messages`.** Adds:
   1. `direction` (inbound, outbound or note), `channel`;
   1. `author_id` (staff `spree_users`, for outbound and notes);
   1. `external_id` (a provider message id);
   1. `read_at`, `delivery_status`;
   1. attachments through ActiveStorage (`has_many_attached :attachments`).
1. **New messages.** A new message's thread is set explicitly by the chat code. The old
   `assign_thread_id` callback keeps running only when no thread is given.
1. **Channels.**
   1. `Chat::Channels.register(name, klass)`. A channel delivers outbound messages
      (`deliver(message)`) and may receive inbound ones.
   1. `web` delivers by doing nothing: the widget polls.
   1. `email` sends a "You have a reply" email with the message and a link back to the
      storefront chat (`?chat=<conversation token>`), only when the customer has an email and
      hasn't been seen in the last 5 minutes. It uses the app's existing mailer setup.
   1. Inbound email, SMS, WhatsApp and Instagram are later channels on the same interface. They
      are left out now, with the interface documented.

## 5. Storefront chat and visit API (dna-admin, public)

Under `/api/v1/storefront`. Identity is the `visitor_token`, sent in the `X-Visitor-Token`
header; a signed-in user's Spree token links the contact to the user. Rate limited per token
and per IP (Rack::Attack if present, otherwise a simple cache counter). CORS follows the
existing storefront API.

| Endpoint | Purpose |
| --- | --- |
| `POST visits` | `{ url, title, referrer, utm?, order_token? }` registers a page view and heartbeat (send on every route change and every 60 s while visible). It creates the contact and session when needed and returns `{ visitor_token, session_id }` |
| `GET chat` | The visitor's open conversation, or `{ conversation: null }`. Includes `greeting` and `online` (staff active, i.e. a paired admin device seen in the last 10 minutes, or business hours from config) |
| `GET chat/messages?after=<id>` | Messages the customer may see (no notes), oldest first, for polling every 5 s while open and every 30 s when minimised |
| `POST chat/messages` | `{ body, name?, email? }` creates the conversation if needed, stores the message inbound, calls `SpreeAdminNative::Inbox.notify_inbound`, and returns the message |
| `POST chat/read` | Marks outbound messages read |
| `GET chat/resume?token=` | Resumes a conversation from the email link: the token is a signed conversation id and contact |

Limits:

1. A message body is 1 to 4000 characters.
1. Each token can send 20 messages per minute, and each IP can create 5 new conversations per
   hour.

## 6. App

1. **Menus.** A type with `view.type === 'tree'` opens a tree screen instead of the list:
   1. a segmented control or tabs of groups, from the group type, with a sheet to add, rename
      or delete groups;
   1. the nested list with drag handles to reorder, and indent and outdent by swipe or menu
      actions (a "Move" sheet picking the parent and position is the accessible path);
   1. inline add (child or sibling);
   1. tap to edit in the existing record form, with the link field as a kind picker plus a URL
      field or a reference picker;
   1. a visibility toggle on each row when the type has a boolean `is_visible`-like field (the
      host marks it with `field … hint` or the app looks for `is_visible` or `visible`).
   1. Moves are saved with `PATCH tree` after each drop, optimistic, with undo on failure.
   The More screen shows one "Menus" row (the tree type), not two.
1. **Inbox.** When the store has `inbox`, an Inbox tab replaces Customers in the tab bar, and
   Customers moves to More.
   1. The list has filters (Open, Mine, Unassigned, Closed), search, and an unread badge on the
      tab from `summary`.
   1. The conversation screen is a chat:
      1. bubbles, with inbound on the left;
      1. notes styled differently;
      1. a composer with send and a note toggle;
      1. attach a photo (existing picker and uploads);
      1. typing state not needed.
   1. A header button opens a customer sheet with the customer context: contact, live session
      with its current page, cart items, recent orders linking to the order screen, and
      assign, snooze and close actions.
   1. Polling: every 5 s on an open conversation and every 20 s on the list (`updated_since`),
      paused in the background. A push with `type: 'inbox'` opens the conversation.
1. **Visitors and carts.** A Home card shows "N online · M carts" when either capability is
   there. It opens a Visitors screen with segments:
   1. **Live:** online sessions with page, time, device, cart and a Message button. It
      refreshes every 15 s.
   1. **Carts:** active and abandoned, with email, items, total and time, linking to the order
      when it's a real order.
   1. A session's detail shows a page timeline and its cart.

## 7. Storefront widget (dna-frontend)

1. **Off by default.** `NEXT_PUBLIC_CHAT_ENABLED=true` turns it on. Tracking
   (`NEXT_PUBLIC_VISITOR_TRACKING`, default on when chat is on) can be turned on separately.
   Neither loads when the visitor declines the cookie or consent banner, if the site has one.
1. **The widget.** A sticky launcher bubble opens a panel:
   1. a greeting;
   1. a message list;
   1. a composer;
   1. on the first message, optional name and email fields ("so we can reply by email");
   1. an unread dot when minimised.
   It is themed from the site's Tailwind tokens and CSS variables, accessible (focus trap,
   Escape, labels and live region), and works on mobile as a full-height sheet.
1. **Visit pings.** `POST visits` on route change and every 60 s while the tab is visible,
   carrying the cart's order token when there is one.
1. **Resuming.** `?chat=<token>` opens the widget and resumes the conversation.
