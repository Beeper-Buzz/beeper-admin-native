# Spree matrix (Docker)

Two local Spree stores with the same admin scenario, used for contract tests,
recordings and manual testing of the app.

| Version | Base URL | Admin UI | Image | Database |
| --- | --- | --- | --- | --- |
| Spree 4.2.7 (vanilla upstream) | http://localhost:3042 | http://localhost:3042/admin | built from `4.2/Dockerfile` | Postgres 16 (`spree42-db`) |
| Spree 6.0.6 | http://localhost:3060 | http://localhost:3060/dashboard | `ghcr.io/spree/spree:6.0.6` (official) | Postgres 18 (`spree60-db`) |

Read [FINDINGS.md](./FINDINGS.md) before designing anything against these
stores. The biggest surprise: **Spree 4.2 has no Platform API**. It arrived in
4.3, and orders, shipments, payments and stock only arrived in 4.4. On 4.2 the
admin API is the legacy REST API v1 (`X-Spree-Token`).

## Run

```sh
node scripts/spree-up.mjs all            # or 4.2 / 6.0
node scripts/spree-up.mjs 6.0 --reset    # wipe that version's DB + storage volumes first
node scripts/spree-up.mjs all --json     # machine-readable URLs + credentials on stdout
node scripts/spree-up.mjs 4.2 --no-seed  # start + wait for health only
```

The script builds the 4.2 image, starts the containers, waits for health, loads
sample data, runs the scenario seed and prints the credentials. It needs
Docker with the compose plugin and plain Node 22, with no npm install. Timings
on a warm cache:

- First 4.2 image build: about 5 minutes. `sassc` and `nokogiri` compile natively.
- First boot of 4.2: about 3 minutes. The entrypoint runs 312 migrations, the
  default seeds and `spree_sample`.
- First boot of 6.0: about 1 minute, including `spree:load_sample_data`.
- Re-running the script against running stores: about 30 seconds. The seeds are
  idempotent: they create nothing new and print the same credentials.

You can also use compose directly:

```sh
docker compose -f infra/spree/docker-compose.yml up -d spree42 spree60
docker compose -f infra/spree/docker-compose.yml exec spree42 bin/rails runner /seed/seed.rb
docker compose -f infra/spree/docker-compose.yml exec spree60 bin/rails runner /seed/seed.rb
docker compose -f infra/spree/docker-compose.yml down        # keep data
docker compose -f infra/spree/docker-compose.yml down -v     # drop data
```

`infra/spree/<version>/` is mounted at `/seed` in each container, so changes
to `seed.rb` apply without a rebuild.

The 4.2 store also mounts `4.2/initializers/admin_native_demo_types.rb` into
`config/initializers/`: demo admin types (refund reasons with a Retire action, zones, countries,
states referencing countries) for the app's generic admin screens and
`packages/spree-sdk/contract/resources.contract.ts`. Restart the container after editing it.

It also mounts `4.2/initializers/admin_native_demo_inbox.rb` (companion gem 0.7, demo only): an
inbox adapter and a visitors adapter over three small tables the initializer creates if they
don't exist (`admin_native_demo_conversations`, `admin_native_demo_messages`,
`admin_native_demo_sessions`), and a demo tree, `taxons` grouped by the hidden `taxonomies`
type. It seeds nothing; contract tests create data through the runner:

```sh
docker compose -f infra/spree/docker-compose.yml exec -T spree42 bin/rails runner \
  'puts AdminNativeDemo.inbound!(name: "Ada", email: "ada@example.com", body: "Is this in stock?").to_json'
# => {"conversation_id":"1","message_id":"1"}; also pushes to paired devices (throttled)
docker compose -f infra/spree/docker-compose.yml exec -T spree42 bin/rails runner \
  'puts AdminNativeDemo.visit!(name: "Ada", email: "ada@example.com", url: "/products/mug", title: "Mug").to_json'
# => {"session_id":"1"}; pass session_id: to add page views, at: for an older visit
docker compose -f infra/spree/docker-compose.yml exec -T spree42 bin/rails runner 'AdminNativeDemo.clear!'
```

## Credentials

The same on both stores:

- Admin: `admin@example.com` / `spree123`. On 4.2 this account has the
  `admin` role. On 6.0 it is a `Spree::AdminUser` with the `admin` role on the
  default store.
- Customers: `customer1@example.com` … `customer6@example.com` / `spree123`.

The seed generates some credentials and prints them. They stay the same across
re-seeds and change only after `--reset`:

| Printed key | What it is | How to use it |
| --- | --- | --- |
| `SPREE42_ADMIN_API_KEY` | admin user's `spree_api_key` (API v1) | `X-Spree-Token: <key>` on `/api/v1/*` |
| `SPREE42_OAUTH_UID` / `SPREE42_OAUTH_SECRET` | Doorkeeper app `spree-admin-native`, scopes `read write admin` | `client_id`/`client_secret` on `POST /spree_oauth/token` (password grant only, see FINDINGS) |
| `SPREE60_SECRET_API_KEY` | `sk_…` secret key, scopes `read_all,write_all` | `X-Spree-Api-Key: <key>` on `/api/v3/admin/*` |
| `SPREE60_PUBLISHABLE_API_KEY` | `pk_…` publishable key | `X-Spree-Api-Key: <key>` on `/api/v3/store/*` |

Spree 6 stores only an HMAC of the secret key, so the seed keeps the plaintext
in `/rails/storage/.spree-admin-native-api-key` on the `spree60_storage`
volume. That lets re-seeds print the same key. If the file is lost, the seed
revokes the old key and mints a new one.

These are fixture credentials for local stores. The ports bind to `0.0.0.0` so
a phone on the LAN can reach them. Do not expose them anywhere else.

## Seeded scenario

The two stores share the same scenario, expressed in each version's own
vocabulary. Seeds sit on top of the stock sample data: spree_sample on 4.2 and
`spree:load_sample_data` on 6.0. Each of those adds 2 sample orders.

| Scenario | 4.2 (`state/payment_state/shipment_state`) | # | 6.0 (`status/payment_status/fulfillment_status`) | # |
| --- | --- | --- | --- | --- |
| paid, not shipped | complete/paid/ready | 9 | placed/paid/unfulfilled | 9 |
| balance due | complete/balance_due/pending (Check payment authorized) | 4 (+2 sample) | placed/authorized (3, +2 sample), placed/none (2), placed/partially_paid (1) | 6 (+2 sample) |
| payment failed | complete/failed/pending | 2 | (no equivalent; 6.0 has no failed payment state) | 0 |
| canceled | canceled/void/canceled | 3 | canceled/none/canceled | 3 |
| shipped | complete/paid/shipped | 9 | placed/paid/fulfilled (6) and delivered (3) | 9 |
| other | complete/credit_owed/ready | 2 | placed/refunded/fulfilled, placed/partially_refunded/fulfilled | 2 |
| **complete orders** | | **31** | | **31** |

Other details:

- Orders are numbered `R420000001`…`R420000029` on 4.2. On 6.0 they use
  normal sequential numbers (`R1003`…) and the seed tracks them with
  `metadata.dna_seed = "S01"…"S29"`.
- `completed_at` is spread over the last 30 days.
- Low stock: the variant with the lowest SKU has exactly 2 on hand, and the
  seeds never order it. On 4.2 that is a "Dress With Belt" variant. On 6.0 it
  is `2-SLICE-TOASTER-BLACK`, which the 6.0 dashboard counts as
  `low_stock_items: 1`.
- Orders are created through each version's own checkout and workflow code
  (4.2 `order.next!`, `payment.capture!`, `shipment.ship!` and
  `canceled_by`; 6.0 `Orders::Create`, `Orders::Complete`, `Payments::Process`,
  `Fulfillments::Fulfill`, `Orders::Cancel` and `Refunds::Create`). Their
  states are real, not written by hand.

## Recordings

`recordings/<version>/orders.list.json` (page size 5) and `orders.show.json`
are real responses captured from these stores. They are meant as test
fixtures; FINDINGS.md §e has the exact commands. 4.2's order `token` (the
guest-checkout token) is replaced with `[REDACTED order guest token]`. Neither
file contains API keys. The catalog recordings (`products.*`, 4.2 `users.*`,
6.0 `customers.*`) are listed in FINDINGS.md §f.

## Version pins

| Piece | Pin | Why |
| --- | --- | --- |
| 4.2 base image | `ruby:2.7.8-bullseye` | Spree 4.2 needs Rails 6.1 and Ruby 2.7 |
| RubyGems / Bundler | 3.4.22 / 2.4.22 | the last releases that support Ruby 2.7 |
| Rails | 6.1.7.10 | the last 6.1 release |
| spree / spree_auth_devise / spree_gateway | 4.2.7 / 4.3.4 / 3.9.4 | the latest in each line compatible with 4.2 |
| `concurrent-ruby` | 1.3.4 | 1.3.5 drops `require "logger"`, and Rails 6.1 then crashes at boot (`uninitialized constant ActiveSupport::LoggerThreadSafeLevel::Logger`) |
| `json` | `~> 2.7` (2.21.2) | json 3.x removed `quirks_mode`, which ActiveSupport 6.1 still passes, so every JSON render returns 500 (`ArgumentError: unknown keyword: quirks_mode`) |
| Node in the 4.2 image | binary copied from `node:18-bullseye-slim` | only needed as the ExecJS runtime for autoprefixer |
| 6.0 image | `ghcr.io/spree/spree:6.0.6` | the official prebuilt image, as used by `spree/spree_starter`'s compose file (Rails 8.1.4.1, Ruby 4.0.10). No Redis: Solid Queue/Cache/Cable run on Postgres |
| Postgres | 16-alpine (4.2), 18-alpine (6.0) | 18 matches spree_starter |

The full 4.2 dependency set is locked in `4.2/Gemfile.lock` (platforms `ruby`
and `x86_64-linux`). On arm64, nokogiri builds from source.

## Known gotchas

- **Docker Hub rate limits (HTTP 429).** Base images are pulled from
  `mirror.gcr.io/library/...`, Google's pull-through mirror of Docker Hub. Set
  `SPREE_IMAGE_REGISTRY=docker.io/library` to use Docker Hub directly.
- **Debian bullseye is EOL.** Its security pool returns 404 on deb.debian.org,
  so the 4.2 image runs no `apt-get` at all. Node is copied from the node
  image, and everything else is already in `ruby:2.7.8-bullseye`
  (buildpack-deps).
- **Spree 4.2 cannot boot without a database.** `Spree::User` reads a
  preference from `spree_preferences` when the class loads. The generators
  (`spree:install`, `spree:auth:install`) therefore run during the build
  against a throwaway Postgres 13. Its binaries are bind-mounted from
  `postgres:13-bullseye` for that one `RUN` step and do not end up in the
  image.
- **libsass segfaults on 4.2.** With the default `:async` ActiveJob adapter,
  order-confirmation mails render in several job threads at once. Their
  concurrent SassC/Sprockets compiles crash libsass (`[BUG] Segmentation
  fault … sassc/engine.rb:43`). The image sets `active_job.queue_adapter =
  :inline` and `perform_deliveries = false` in development, and the seed does
  the same.
- **4.2 runs in the `development` environment**, so there is no asset
  precompile and no SSL. `config.hosts` is cleared so LAN IPs and other
  hostnames work. The first admin page load compiles assets, which takes a few
  seconds.
- **The 4.2 healthcheck uses `/api/v2/storefront/products`.**
  `/api/v2/storefront/store` does not exist on 4.2. Spree's catch-all answers
  any unknown `/api/*` path with `301 → /api/v1/<path>.json → 404`. curl
  without `-L` treats that 301 as success.
- **Spree 6 creates an admin from env vars only.** Seeds create the first
  admin only when both `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set. Otherwise
  they print a one-time `/dashboard/setup?token=…` link. Compose sets both.
- **Spree 6 refuses to over-pay.** Payment validation forbids paying more than
  the order total, so 6.0 cannot seed `overcharged`.
- **Building behind a TLS-intercepting proxy.** The 4.2 build accepts
  `SPREE_BUILD_PROXY` (passed as `http_proxy`/`https_proxy`; Bundler only
  reads `http_proxy`) and an optional BuildKit secret
  `SPREE_BUILD_CA_FILE` (a PEM bundle). Neither persists in the image. The
  build uses `network: host` so a proxy on `127.0.0.1` is reachable.
  `spree-up.mjs` fills both in from `HTTPS_PROXY` and `SSL_CERT_FILE` when
  they are set.
- The 4.2 Rails log is noisy: Ruby 2.7 `net-protocol` constant warnings,
  FriendlyId `acts_as_paranoid`, and autoload deprecations. These are harmless.
