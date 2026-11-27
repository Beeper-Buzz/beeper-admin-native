# Spree admin API findings (4.2.7 and 6.0.6)

Established on 2026-11-26 against the stores in this directory
(`node scripts/spree-up.mjs all`) using curl. Every status code below was
observed live unless it is marked *(gem source)*. Commands use these shell
variables, all printed by `spree-up.mjs`:

```sh
B42=http://localhost:3042; B60=http://localhost:3060
KEY42=<SPREE42_ADMIN_API_KEY>  UID42=<SPREE42_OAUTH_UID>  SECRET42=<SPREE42_OAUTH_SECRET>
KEY60=<SPREE60_SECRET_API_KEY>  PK60=<SPREE60_PUBLISHABLE_API_KEY>
```

## Summary: what this means for the app's auth design

1. **Spree 4.2 has no Platform API.** `spree_api` 4.2.7 ships only API v1
   (legacy REST) and Storefront API v2. Gem file lists show:
   - 4.3.0 adds `api/v2/platform`, but only addresses, classifications, CMS,
     countries, menus, option types/values, products, taxons and users. There
     are still **no orders** (4.3.3 is the same).
   - 4.4.0 is the **first version with Platform `orders`, `shipments`,
     `payments`, `line_items`, `stock_items` and `webhooks`**.

   On 4.2 (and 4.3), admin order management must use **API v1 with
   `X-Spree-Token: <user.spree_api_key>`**. Spec §3.4's row
   "4.2 – 4.4 → Platform API v2" is wrong for 4.2 and 4.3. Platform webhooks
   exist from 4.4.0, not "≥ 4.5 (verify)".
2. **On 4.2, signing in with email and password cannot reach admin data.**
   - The password grant works (200), but the token only authorizes Storefront
     v2 account endpoints.
   - API v1 ignores Bearer tokens (401 "You must specify an API key.").
   - No endpoint exchanges a password for the `spree_api_key`. An admin
     generates it in the Spree admin UI (Users → edit → API key), or the
     companion gem issues it.
   - On 4.2 the Connect flow therefore has to be "paste API key" or "pair
     with the gem". A Phase 0 spike is not needed: the answer is no.
3. **`client_credentials` is not enabled on 4.2** (`grant_flows %w(password)`;
   400 `unsupported_grant_type`). It is enabled from 4.3. On 4.4+ the
   Platform API requires a token bound to an OAuth application
   (`validate_token_client`) with the `admin` scope *(gem source)*.
4. **Spree 6.0 email + password login works.** `POST /api/v3/admin/auth/login`
   returns a 5-minute HS256 JWT in the body. The refresh token is only an
   `HttpOnly` signed cookie scoped to `/api/v3/admin/auth`, valid for 30 days
   and rotated on every refresh. The refresh call needs **no CSRF token, no
   API key and no Origin**: the cookie alone is enough. A native client can
   capture the `Set-Cookie` value and replay it as a `Cookie:` header (200).
5. **Spree 6.0 has no `/api/v2/*` at all, and no `/spree_oauth/token`** (404).
   The JWT and the `sk_` secret key (`X-Spree-Api-Key`) both work on
   `/api/v3/admin/*`. `/me` only works with a JWT: there is no "who am I" for
   API keys.
6. **Fingerprinting:**
   - Spree ≤ 4.x answers every unknown `/api/*` path with
     **`301 → /api/v1/<path>.json`**, which then returns 404. Probes must use
     `redirect: 'manual'`. A followed 301 looks like "404, not Spree", but the
     301 itself is a strong Spree 4.x signature.
   - The spec's probe of `GET /api/v2/platform/...` returning 401 does not
     happen on 4.2. It is a 301.
   - Use `GET /api/v1/orders` instead: 401 with body
     `{"error":"You must specify an API key."}`.
   - Spree 6 answers 401 JSON on `/api/v3/admin/*` and `/api/v3/store/*`, and
     404 on every v1/v2 path.

## a. Spree 4.2: OAuth tokens vs. admin data

```sh
# a1. password grant with scope=admin, no client credentials
curl -s -X POST $B42/spree_oauth/token -d grant_type=password \
  -d username=admin@example.com -d password=spree123 -d scope=admin
```
```
HTTP 400  {"error":"invalid_scope","error_description":"The requested scope is invalid, unknown, or malformed."}
```
4.2 configures no server scopes (no `default_scopes`/`optional_scopes`), so
any scope is invalid unless the request names an OAuth application whose
scopes include it:

```sh
# a2. password grant, no scope
curl -s -X POST $B42/spree_oauth/token -d grant_type=password \
  -d username=admin@example.com -d password=spree123
```
```
HTTP 200  {"access_token":"pHhE…","token_type":"Bearer","expires_in":7200,"refresh_token":"bg0H…","created_at":1795700655}
```
```sh
# a2b. password grant + the seeded OAuth app + scope=admin
curl -s -X POST $B42/spree_oauth/token -d grant_type=password \
  -d username=admin@example.com -d password=spree123 -d scope=admin \
  -d client_id=$UID42 -d client_secret=$SECRET42
```
```
HTTP 200  {"access_token":"B_Jw…","token_type":"Bearer","expires_in":7200,"refresh_token":"_G3y…","scope":"admin","created_at":1795700655}
```
The `admin`-scoped token exists, but nothing on 4.2 accepts it for admin data:

```sh
# a3. Platform orders with the password-grant token
curl -s -i -H "Authorization: Bearer $TOKEN" \
  "$B42/api/v2/platform/orders?include=line_items,shipments,payments,bill_address,user"
```
```
HTTP 301  Location: http://localhost:3042/api/v1/platform/orders.json?include=…
   (following it: HTTP 404 {"error":"The resource you were looking for could not be found."} at /api/404)
```
```sh
# a4. client_credentials with the seeded app
curl -s -X POST $B42/spree_oauth/token -d grant_type=client_credentials \
  -d client_id=$UID42 -d client_secret=$SECRET42 -d scope=admin
```
```
HTTP 400  {"error":"unsupported_grant_type","error_description":"The authorization grant type is not supported by the authorization server."}
```

What the password token *can* do, and what admin access actually requires:

| Request | Status |
| --- | --- |
| `GET /api/v2/storefront/account` + `Authorization: Bearer $TOKEN` | **200** (customer-facing account only) |
| `GET /api/v1/orders` + `Authorization: Bearer $TOKEN` | **401** `{"error":"You must specify an API key."}` |
| `GET /api/v1/orders` (no auth) | **401** `{"error":"You must specify an API key."}` |
| `GET /api/v1/orders` + `X-Spree-Token: nope` | **401** `{"error":"Invalid API key (nope) specified."}` |
| `GET /api/v1/orders` + `X-Spree-Token: $KEY42` (admin's `spree_api_key`) | **200** |
| `POST /spree_oauth/token grant_type=refresh_token` | **200** (new access + refresh token) |
| `POST /spree_oauth/token` as `customer1@example.com` | **200** (any user gets a token; there is no admin gate) |

Background *(gem source)*: `spree_api-4.2.7/config/initializers/doorkeeper.rb`
has `grant_flows %w(password)` and no scopes. API v1 authenticates only with
`request.headers['X-Spree-Token'] || params[:token]`, looked up against
`spree_users.spree_api_key`. API v1 filters work through Ransack: for example
`GET /api/v1/orders?q[shipment_state_eq]=ready&q[payment_state_eq]=paid`
returned the 9 seeded orders (live; use `curl -g`).

## b. Spree 4.2: admin actions that exist

`bin/rails routes | grep platform` prints **nothing**: 0 of 863 routes match.
The relevant API v1 routes (`bin/rails routes`, trimmed to verb, path and
action; `(.:format)` removed):

```
GET    /api/v1/orders                                            orders#index   (q[...] ransack, page, per_page)
GET    /api/v1/orders/:id                                        orders#show    (:id = order number)
PUT    /api/v1/orders/:id/cancel                                 orders#cancel
PUT    /api/v1/orders/:id/approve                                orders#approve
PUT    /api/v1/orders/:id                                        orders#update
PUT    /api/v1/orders/:order_id/payments/:id/authorize           payments#authorize
PUT    /api/v1/orders/:order_id/payments/:id/capture             payments#capture
PUT    /api/v1/orders/:order_id/payments/:id/purchase            payments#purchase
PUT    /api/v1/orders/:order_id/payments/:id/void                payments#void
PUT    /api/v1/orders/:order_id/payments/:id/credit              payments#credit   <- the only refund path in v1
POST   /api/v1/orders/:order_id/payments                         payments#create
PUT    /api/v1/orders/:order_id/return_authorizations/:id/{add,receive,cancel}
PUT    /api/v1/shipments/:id/ship                                shipments#ship    (:id = shipment number)
PUT    /api/v1/shipments/:id/ready                               shipments#ready
PUT    /api/v1/shipments/:id                                     shipments#update  (tracking)
PUT    /api/v1/shipments/:id/{add,remove}                        shipments#add/remove
POST   /api/v1/shipments/transfer_to_location|transfer_to_shipment
GET    /api/v1/stock_locations/:stock_location_id/stock_items    stock_items#index
PUT    /api/v1/stock_locations/:stock_location_id/stock_items/:id stock_items#update
PUT    /api/v1/stock_items/:id                                   stock_items#update
POST   /api/v1/stock_locations/:stock_location_id/stock_items    stock_items#create
```

| Capability | 4.2 Platform v2 | 4.2 API v1 |
| --- | --- | --- |
| list/show orders | none | yes |
| order cancel | none | `PUT /api/v1/orders/:number/cancel` |
| shipment ship | none | `PUT /api/v1/shipments/:number/ship` |
| payment capture / void | none | `PUT …/payments/:id/capture`, `…/void` |
| refunds | none | no `Spree::Refund` endpoint. Only `PUT …/payments/:id/credit`; refunds are otherwise admin-HTML only (`POST /admin/orders/:id/payments/:id/refunds`) |
| stock item update | none | `PUT /api/v1/stock_locations/:sl/stock_items/:id` |
| webhooks | none | none |

The write actions were not exercised (that would mutate the fixtures). They are
listed from `rails routes`.

## c. Fingerprinting probes (no auth)

`curl -s -o /dev/null -w "%{http_code} %{redirect_url}"`, without following redirects:

| Path | Spree 4.2.7 | Spree 6.0.6 |
| --- | --- | --- |
| `GET /api/v2/platform/orders` | **301** → `/api/v1/platform/orders.json` (→ 404) | **404** |
| `GET /api/v3/admin/orders` | **301** → `/api/v1/admin/orders.json` (→ 404) | **401** `{"error":{"code":"authentication_required","message":"Authentication required"}}` |
| `GET /api/v3/store/store` | 301 (→ 404) | **401** `{"error":{"code":"invalid_token","message":"Valid API key required"}}`; **200** with `X-Spree-Api-Key: $PK60` |
| `GET /api/v2/storefront/store` | **301** → `/api/v1/storefront/store.json` (→ 404). *There is no `/store` on 4.2* | 404 |
| `GET /api/v2/storefront/stores/:code` | **200** for code `spree` (JSON:API store: name, url, `default_currency`, `supported_currencies`, `default_locale`, …) | 404 |
| `GET /api/v2/storefront/products?per_page=1` | **200** `application/vnd.api+json` | 404 |
| `GET /api/v2/storefront/countries/default` | **200** | 404 |
| `GET /api/v1/orders` | **401** `{"error":"You must specify an API key."}` | 404 |
| `GET /api/admin_native/v1/capabilities` | 301 (→ 404) | 404 |
| `POST /spree_oauth/token` (empty body) | **400** | **404** |
| `GET /up` | 404 | **200** (Rails 8 health) |
| `GET /admin` | 301 → `/admin/orders` (→ `/admin/login`) | 404 |
| `GET /dashboard` | 404 (via storefront) | **200** (React dashboard) |

Neither version sends a version header (no `X-Spree-*` and no `Server`). Find
the version from the API family. On 4.x the store's code is not discoverable
without auth: `stores/:code` needs it, and on this store `spree` is the default
code.

## d. Spree 6.0: Admin API authentication

### Login

```sh
curl -s -i -c jar -X POST $B60/api/v3/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"spree123"}'
```
```
HTTP/1.1 200 OK
cache-control: private, no-store
set-cookie: spree_admin_refresh_token=<Rails signed cookie>; path=/api/v3/admin/auth; expires=Sat, 26 Dec 2026 13:45:57 GMT; httponly; samesite=lax

{"token":"eyJhbGciOiJIUzI1NiJ9.…",
 "user":{"id":"adm_UkLWZg9DAJ","email":"admin@example.com","first_name":"Spree","last_name":"Admin",
         "full_name":"Spree Admin","selected_locale":null,"status":"active","created_at":"…","updated_at":"…",
         "last_active_at":"…","avatar_url":null,
         "roles":[{"id":"role_UkLWZg9DAJ","name":"admin"}],
         "stores":[{"id":"store_UkLWZg9DAJ","name":"Shop","code":"shop"}]}}
```

- The JWT is HS256. Its claims are
  `{"user_id":1,"user_type":"admin","jti":"…","iss":"spree","aud":"admin_api","exp":…}`
  with **TTL 300 s** (`Spree::Api::Config[:admin_jwt_expiration]`, env
  `SPREE_ADMIN_JWT_EXPIRATION`). There is no `iat`. The secret falls back to
  `secret_key_base` unless `JWT_SECRET_KEY` is set.
- **The refresh token never appears in the body.** It is only the `HttpOnly`
  cookie, valid for 30 days. Over HTTPS the cookie is `Secure; SameSite=None`;
  over plain HTTP it is `SameSite=Lax`.
- Wrong password → 401
  `{"error":{"code":"authentication_failed","message":"Invalid email or password"}}`.
  A customer's credentials get the same 401, because admin login only checks
  `Spree::AdminUser`.

### Refresh

```sh
curl -s -i -b jar -c jar -X POST $B60/api/v3/admin/auth/refresh   # no body, no headers
```
```
HTTP 200  set-cookie: spree_admin_refresh_token=<new value>; path=/api/v3/admin/auth; expires=…; httponly; samesite=lax
          {"token":"<new JWT>","user":{…same shape as login…}}
```

| Refresh variant | Status |
| --- | --- |
| cookie only (no CSRF header, no API key, no Origin) | **200**, rotated cookie |
| cookie only + `Origin: https://evil.example` | **200** (CORS is the only Origin defence; it does not block non-browser clients) |
| manual `Cookie: spree_admin_refresh_token=<value>` header (no cookie jar) | **200** |
| the *previous* (already rotated) cookie | **401** `{"error":{"code":"invalid_refresh_token","message":"Invalid or expired refresh token"}}`. The newer cookie keeps working: there is no reuse detection or family revocation |
| no cookie | **401** `{"error":{"code":"invalid_refresh_token","message":"Refresh token cookie missing"}}` |
| refresh value sent as JSON body `{"refresh_token":…}` | **401** "Refresh token cookie missing" |

**CSRF:** none is required, and no CSRF token exists for clients to obtain.
`spree_api-6.0.6/app/controllers/concerns/spree/api/v3/admin/auth_cookies.rb`
says so explicitly ("We deliberately do NOT use a CSRF token here… SameSite +
`Spree::AllowedOrigin` allowlist via Rack::Cors"). The OpenAPI spec
(`spreecommerce.org/docs/api-reference/admin.yaml`) and the `@spree/admin-sdk`
6.0.6 JSDoc both mention an "`X-CSRF-Token` header (set by the SDK)", and the
spec lists `x-spree-api-key` as required on `/auth/refresh`. Both are stale:
the SDK never sets such a header, and the server checks neither.

For the app, use cookie-less storage. Capture `Set-Cookie` from login and
refresh, keep the cookie value in secure storage, and send it as `Cookie:`
only to `/api/v3/admin/auth/refresh` and `/logout`. Alternatively, let the
platform's cookie jar handle it, since the cookie path is scoped to
`/api/v3/admin/auth`. Refresh before `exp`, or on any 401: an expired JWT
gets the same generic 401 `authentication_required` as a garbage one, so the
client cannot tell them apart.

### Orders with JWT vs. secret key

| Request | Status |
| --- | --- |
| `GET /api/v3/admin/orders?limit=5` + `Authorization: Bearer <JWT>` | **200** `{"data":[…5],"meta":{"page":1,"limit":5,"count":31,"pages":7,"from":1,"to":5,"in":5,"previous":null,"next":2}}` |
| same + `X-Spree-Api-Key: $KEY60` (`sk_…`, scopes `read_all,write_all`) | **200** |
| same + `Authorization: Bearer $KEY60` | **401** `authentication_required` (the key must go in `X-Spree-Api-Key`) |
| same + `X-Spree-Api-Key: $PK60` (publishable) | **401** |
| same + expired or garbage JWT | **401** `authentication_required` |
| no auth | **401** `{"error":{"code":"authentication_required","message":"Authentication required"}}` |

Filters are Ransack `q[...]` (live): `q[payment_status_eq]=paid&q[fulfillment_status_eq]=unfulfilled`
returns 9, `q[status_eq]=canceled` returns 3, and
`q[fulfillment_status_in][]=fulfilled&q[fulfillment_status_in][]=delivered`
returns 11. Pass `curl -g`, because the brackets are otherwise glob syntax.

### `/api/v2/platform/*` on 6.0

It does not exist. `bin/rails routes` has 0 `api/v2` routes, and
`/api/v2/platform/orders`, `/api/v2/storefront/*`, `/api/v1/*` and
`/spree_oauth/token` all return **404**. (`spree_legacy_api_v2` was not
installed. The official image ships `spree`, `spree_dashboard`,
`spree_emails`, `spree_mcp` and the payment, search and shipping provider
gems.)

### `GET /api/v3/admin/me`

With a JWT:
```json
{"user":{"id":"adm_UkLWZg9DAJ","email":"admin@example.com", "…":"same shape as login.user",
         "roles":[{"id":"role_UkLWZg9DAJ","name":"admin"}],
         "stores":[{"id":"store_UkLWZg9DAJ","name":"Shop","code":"shop"}]},
 "permissions":[{"allow":true,"actions":["manage"],"subjects":["all"],"has_conditions":false}],
 "permission_keys":["read_dashboard","read_reports","write_reports","read_orders","write_orders",
                    "read_payments","write_payments","read_fulfillments","write_fulfillments",
                    "read_refunds","write_refunds","read_products", "… 61 keys in total"]}
```
With the secret key: **404**
`{"error":{"code":"record_not_found","message":"No admin user authenticated this request"}}`.
`permission_keys` is the natural input for the app's capability map.

### `GET /api/v3/admin/dashboard/counters`

Returns 200 with both the JWT and the secret key:

```json
{"channel_id":null,"counters":[
 {"key":"orders_to_fulfill","value":17,"link":{"resource":"orders","filters":[{"field":"fulfillment_status","operator":"in","value":"unfulfilled"}]},"nav":"orders"},
 {"key":"payments_to_collect","value":8,"link":{"resource":"orders","filters":[{"field":"payment_status","operator":"in","value":"none,authorized,partially_paid"}]},"nav":null},
 {"key":"open_returns","value":1,"link":{"resource":"returns","filters":[{"field":"status","operator":"in","value":"requested,approved,received"}]},"nav":"returns"},
 {"key":"open_exchanges","value":0,"link":{"resource":"exchanges","filters":[…]},"nav":"exchanges"},
 {"key":"open_claims","value":0,"link":{"resource":"claims","filters":[…]},"nav":"claims"},
 {"key":"low_stock_items","value":1,"link":{"resource":"inventory","filters":[{"field":"stock_status","operator":"in","value":"low_stock_overall"}]},"nav":null},
 {"key":"out_of_stock_items","value":0,"link":{"resource":"inventory","filters":[…]},"nav":null}]}
```

### 6.0 admin actions (for comparison with b)

From `bin/rails routes`. The domain was renamed: shipments are now
*fulfillments*, and order `state` is now `status`, `payment_status` and
`fulfillment_status`.

```
PATCH /api/v3/admin/orders/:id/cancel                               orders#cancel   (cancel_reason_id, refund_payments, notify_customer)
PATCH /api/v3/admin/orders/:id/complete | /approve                  orders#complete | approve
PATCH /api/v3/admin/orders/:order_id/fulfillments/:id/fulfill       fulfillments#fulfill (items, tracking, tracking_carrier, notify_customer)
PATCH /api/v3/admin/orders/:order_id/fulfillments/:id/mark_delivered|cancel|split
PATCH /api/v3/admin/orders/:order_id/payments/:id/capture | /void   payments#capture | void
POST  /api/v3/admin/orders/:order_id/payments                       payments#create
GET|POST /api/v3/admin/orders/:order_id/refunds                     refunds#index | create
PATCH /api/v3/admin/orders/:order_id/returns/:id/{approve,receive,refund,cancel}
GET|PATCH /api/v3/admin/stock_levels[/:id], POST /api/v3/admin/stock_levels/bulk_upsert
```

## e. Recordings

Saved under `recordings/<version>/`. Each list is the first page of size 5 in
the API's default order. Each detail is a shipped order with several items.

```sh
# 4.2: API v1, because Platform v2 does not exist (see b). Order `token` redacted afterwards.
curl -s -H "X-Spree-Token: $KEY42" "$B42/api/v1/orders?per_page=5"         > recordings/4.2/orders.list.json
curl -s -H "X-Spree-Token: $KEY42" "$B42/api/v1/orders/R420000024"         > recordings/4.2/orders.show.json

# 6.0: Admin API v3. `expand` mirrors the include list the app wanted from Platform v2.
EXP=items,fulfillments,payments,billing_address,customer
curl -s -H "X-Spree-Api-Key: $KEY60" "$B60/api/v3/admin/orders?limit=5&expand=$EXP"  > recordings/6.0/orders.list.json
curl -s -H "X-Spree-Api-Key: $KEY60" "$B60/api/v3/admin/orders/or_5CQZnCRf8J?expand=$EXP,shipping_address,discounts" \
                                                                                   > recordings/6.0/orders.show.json
```

| File | Content |
| --- | --- |
| `4.2/orders.list.json` | `{"orders":[5 orders],"count":5,"current_page":1,"pages":7}`. v1 list items omit line items, shipments and payments |
| `4.2/orders.show.json` | `R420000024`: complete/paid/shipped, 3 line items, 1 shipment, 1 Check payment, addresses, adjustments, `permissions` |
| `6.0/orders.list.json` | `{"data":[5 orders, expanded],"meta":{…pagination…}}` |
| `6.0/orders.show.json` | `R1029` (`or_5CQZnCRf8J`): placed/partially_refunded/fulfilled, 3 items, fulfillment with UPS tracking, payment, addresses, customer |

The files were scanned for keys and values matching
token/secret/password/api_key/digest/`sk_`/`pk_`. The only hits were 4.2's
per-order guest `token`, now `[REDACTED order guest token]`. IDs, emails
(`customerN@example.com`) and addresses are seed data.

## f. Order actions and promotions (2026-11-26)

Proven by `packages/spree-sdk/contract` on both stores.

| Action | 4.2 (API v1) | 6.0 (Admin API v3) |
| --- | --- | --- |
| Ship | `PUT /api/v1/shipments/:number/ship` with `shipment[tracking]`: the before-action saves tracking, then ships. Needs a `ready` (paid) shipment | `PATCH /orders/:id/fulfillments/:id/fulfill` with `tracking`. Refuses unpaid orders: "This order is not paid for yet" |
| Capture | `PUT /api/v1/orders/:number/payments/:number/capture` | `PATCH /orders/:id/payments/:id/capture` |
| Cancel | `PUT /api/v1/orders/:number/cancel` | `PATCH /orders/:id/cancel` |
| Refund | Routed (`PUT …/payments/:id/credit`) but `PaymentsController` has no `credit` action. The companion gem 0.2 creates a `Spree::Refund` instead (`POST /api/admin_native/v1/orders/:number/payments/:number/refunds`) | `POST /orders/:id/refunds` with `payment_id`, `amount`, `refund_reason_id` |
| Refund reasons | gem `GET refund_reasons` ("Return processing" is seeded) | `GET /refund_reasons` |

Promotions:

1. **4.2**: API v1 only has `GET /api/v1/promotions/:id`. The gem adds list, create and update.
   Spree keeps calculator settings in YAML columns, and Rails 6.1.6.1+ refuses `BigDecimal` from
   YAML unless permitted, so a percent or fixed discount saved but couldn't be read back (500 on
   the next load, in Spree admin too). The gem permits `BigDecimal`.
2. **6.0**: `/api/v3/admin/promotions` with `expand=actions` returns each promotion's actions and
   calculator (`{type: "flat_percent_item_total", preferences: {flat_percent: "20.0"}}`).
   Writes take `actions: [{id?, type: "create_adjustment", calculator: {type, preferences}}]`,
   and that array replaces the whole set, so updates must echo the existing action id.
   `kind` is `coupon_code` or `automatic`; codes are stored lowercase. Ransack allows `name`,
   `code`, `kind`, `starts_at`, `expires_at` (OR groups via `q[g][n][m]=or`).
3. **6.0 bug**: a `PATCH` that fails validation (e.g. `expires_at` before `starts_at`) still
   saves the `actions` change in the same request. The SDK validates the schedule before sending.
## g. Products, stock and customers

Established on 2026-11-26/27 against the same stores, live unless marked
*(gem source)*. These back the `api-v1` and `admin-v3` products and customers
adapters and `packages/spree-sdk/contract/catalog.contract.ts`.

### 4.2: products through API v1

```
GET  /api/v1/products                          products#index  (q[...] ransack, page, per_page, ids=1,2,3)
GET  /api/v1/products/:id                      products#show   (id or slug)
PUT  /api/v1/products/:id                      products#update ({ product: {...} })
PUT  /api/v1/products/:product_id/variants/:id variants#update ({ variant: {...} })
```

- **There is no status column, and the payload can't say a product is
  archived.** v1 renders `available_on` but not `discontinue_on`,
  `deleted_at` or `updated_at`. For admins, the product scope hides
  discontinued (`discontinue_on <= now`) and deleted products unless the
  request adds `show_discontinued=1` / `show_deleted=1` *(gem source:
  `Spree::Api::BaseController#product_scope`)*. That holds for show and
  **update** too: `PUT /api/v1/products/116` on a discontinued product is
  **404**, and the same request with `?show_discontinued=1` is 200.
- The adapter therefore derives status as: found only with `show_*` →
  archived; `available_on` null or in the future → draft; else active. A
  status write maps to draft → `available_on: null, discontinue_on: null`;
  active → `available_on` now (kept if already past), `discontinue_on: null`;
  archived → `discontinue_on` now. All three were accepted live. The model
  refuses a `discontinue_on` earlier than `available_on`, so archiving a
  scheduled draft also clears its future `available_on`. Re-activating sets
  `available_on` to the time of the write, not the original date.
- **`available_on` is not ransackable.** Product Ransack allows `id`, `name`,
  `created_at`, `updated_at`, `description`, `slug` and `discontinue_on`.
  `q[available_on_null]=1` is silently ignored (116 of 116 products come
  back). So:
  - `archived`: `show_discontinued=1&q[discontinue_on_lteq]=<now>`;
  - `all`: `show_discontinued=1`, then one `?ids=…` request (default scope)
    marks as archived the products it doesn't return;
  - `active` / `draft`: filtered in the adapter, reading up to five server
    pages per call. The cursor is `"<page>"` or `"<page>:<rows read>"` and no
    `totalCount` is given.
- Name or SKU search: `q[name_or_variants_including_master_sku_cont]=blue_xs`
  returns 24 products (it is SQL `LIKE`, so `_` matches any character).
- **Prices carry no currency.** `price` is a bare decimal in
  `Spree::Config[:currency]`; `display_price` is `"$69.99"`. The adapter reads
  the default store's `default_currency` from `GET /api/v1/stores` once.
- **`compare_at_price` is write-only in v1.** Both `variant[compare_at_price]`
  and `product[compare_at_price]` are permitted and saved, but no v1 view
  renders it, so the adapter reports `compareAtPrice: null`. The 4.2
  Storefront API does render it
  (`GET /api/v2/storefront/products/:slug?include=variants`, active products
  only), and the contract test reads it there to prove the write.
- **A master can't be written through the variants endpoint** when the
  product has option variants: `PUT /api/v1/products/116/variants/116` is
  404, while variant 232 of the same product is 200. `PUT
  /api/v1/products/116` with `product[price]`, `product[compare_at_price]` or
  `product[sku]` writes the master (delegated), which is what the adapter does.
- Untracked variants report `total_on_hand` as infinity; the adapter maps
  them to `null`. The 4.2 seed has no product images.
- **v1 reads are publicly cacheable**: products index/show and users index
  answer `Cache-Control: public, max-age=900` (`expires_in 15.minutes, public:
  true`). A client cache that honours it (NSURLCache) would show a product as
  it was before an edit, so the adapters send `Cache-Control: no-cache` on
  these reads.

### 4.2: stock

```sh
curl -s  -H "X-Spree-Token: $KEY42" "$B42/api/v1/stock_locations"     # ordered by name; one, "default"
curl -sg -H "X-Spree-Token: $KEY42" "$B42/api/v1/stock_locations/1/stock_items?q[variant_id_eq]=232"
curl -s -X PUT -H "X-Spree-Token: $KEY42" -H 'Content-Type: application/json' \
  -d '{"stock_item":{"count_on_hand":7,"force":true}}' "$B42/api/v1/stock_locations/1/stock_items/232"
```

- Without `force: true`, `count_on_hand` is **added** to the current count;
  with it the count is set (35 → 7 → 35 live). `POST …/stock_items` creates a
  missing item and adjusts it by `count_on_hand`.
- v1 doesn't render a location's `default` flag, and neither `default` nor
  `active` is ransackable, so the adapter uses the first active location in
  the API's (name) order.

### 4.2: customers are users

- `GET /api/v1/users` takes **no Ransack**. `q[email_start]=x` selects
  `with_email` (`email LIKE '%x%'`); adding `q[ship_address_firstname_start]=x`
  selects `with_email_or_address` (email, or any saved address's first or
  last name). Both are **case-sensitive** on Postgres:
  `q[email_start]=Customer1` finds nothing. The address join can repeat a
  user; the adapter drops repeats.
- A user is `id`, `email`, `created_at`, `updated_at` and the bill and ship
  addresses: names and phone only come from those (the seed users have none).
  The list has `count`, `current_page` and `pages`, but no total.
- Order count:
  `GET /api/v1/orders?q[user_id_eq]=3&q[completed_at_not_null]=1&per_page=1`
  answers `pages: 5`. (`user_id` isn't a ransackable order attribute, but
  `user_id_eq` resolves through the ransackable `user` association.)
  `customers.get` spends this one request; the list leaves `ordersCount` and
  `totalSpent` null.

### 6.0: Admin API v3

```sh
curl -sg -H "X-Spree-Api-Key: $KEY60" \
  "$B60/api/v3/admin/products?q[search]=espresso&q[status_eq]=active&sort=-created_at&expand=variants,option_types,media"
curl -s -X PATCH -H "X-Spree-Api-Key: $KEY60" "$B60/api/v3/admin/products/prod_8cR0I7fEbw/archive"   # also /draft, /activate
curl -s -X PATCH -H "X-Spree-Api-Key: $KEY60" -H 'Content-Type: application/json' \
  -d '{"prices":[{"currency":"USD","amount":"899.99","compare_at_amount":"999.00"}]}' \
  "$B60/api/v3/admin/products/prod_UkLWZg9DAJ/variants/variant_EfhxLZ9ck8"
curl -s -X POST -H "X-Spree-Api-Key: $KEY60" -H 'Content-Type: application/json' \
  -d '{"stock_levels":[{"variant_id":"variant_EfhxLZ9ck8","stock_location_id":"sloc_UkLWZg9DAJ","count_on_hand":4990}]}' \
  "$B60/api/v3/admin/stock_levels/bulk_upsert"                             # {"stock_level_count":1}
```

- `q[search]` matches names **and SKUs**
  (`AUTOMATIC-ESPRESSO-MACHINE-SILVER` finds its product). Products are found
  by prefixed id only: `GET …/products/automatic-espresso-machine` is 404.
- **There is no master variant.** `variants` lists every variant, including
  a simple product's only one (`The Spree Commerce Handbook`, 1 variant).
- Status has its own member actions (`activate`, `draft`, `archive`), which
  run Spree's workflow and publish its event *(gem source)*; `status` in a
  plain PATCH skips them. The adapter uses the actions.
- `description` is rich text: reads return a plain-text `description` and the
  stored `description_html`. The adapter reads `description_html` so an edit
  round-trips.
- `prices` on a variant PATCH is upserted by currency and needs `amount`, so
  the adapter sends the current amount when only the compare-at price
  changes. Price-list prices (`price_list_id` set) are untouched. The seed's
  "no compare-at price" is `"0.00"`, read as `null`.
- `stock_levels/bulk_upsert` sets an absolute count and creates the stock
  level when it is missing; each change is recorded as an `adjusted` movement.
  The default location is the one with `default: true` in
  `GET /api/v3/admin/stock_locations`. The digital handbook has
  `track_inventory: false` and `total_on_hand: null`.
- Customers: `GET /api/v3/admin/customers?q[search]=…` matches email and
  first or last name, case-insensitively (`Ada` and `Lovelace` both find
  `customer1@example.com`). Each carries `orders_count` and `total_spent`
  (a bare decimal; the adapter prices it in `GET /api/v3/admin/store`'s
  `default_currency`). Default addresses need
  `expand=default_billing_address,default_shipping_address`.

### Catalog recordings

```sh
curl -sg -H "X-Spree-Token: $KEY42" "$B42/api/v1/products?per_page=3&q[s]=id%20asc" > recordings/4.2/products.list.json
curl -s  -H "X-Spree-Token: $KEY42" "$B42/api/v1/products/1"                       > recordings/4.2/products.show.json
curl -s  -H "X-Spree-Token: $KEY42" "$B42/api/v1/users?per_page=5"                  > recordings/4.2/users.list.json
curl -s  -H "X-Spree-Token: $KEY42" "$B42/api/v1/users/3"                           > recordings/4.2/users.show.json
EXP=variants,option_types,media; CEXP=default_billing_address,default_shipping_address
curl -s -H "X-Spree-Api-Key: $KEY60" "$B60/api/v3/admin/products?limit=3&sort=-created_at&expand=$EXP" > recordings/6.0/products.list.json
curl -s -H "X-Spree-Api-Key: $KEY60" "$B60/api/v3/admin/products/prod_UkLWZg9DAJ?expand=$EXP"         > recordings/6.0/products.show.json
curl -s -H "X-Spree-Api-Key: $KEY60" "$B60/api/v3/admin/customers?limit=3&sort=-created_at&expand=$CEXP" > recordings/6.0/customers.list.json
curl -s -H "X-Spree-Api-Key: $KEY60" "$B60/api/v3/admin/customers/cust_YHETxCGlb0?expand=$CEXP"         > recordings/6.0/customers.show.json
```

Pretty-printed afterwards. The secret scan from §e found nothing in them.

### Contract suite notes

- `proves()` recorded a skipped test as `fail`, because `ctx.skip()` works by
  throwing; that is why earlier runs showed `orders.capture` failing once no
  pending payment was left. Fixed in `contract/env.ts`: a skip records nothing.
- Each contract file merges its results into `contract-results/<label>.json`
  (a failure wins); `contract/setup.ts` empties that file when a run starts.
- The order action tests use up seeded data: each run captures one pending
  payment, ships one fulfillment and cancels one order. After enough runs
  `orders.capture` skips and the 6.0 "filters unpaid orders" test fails for
  want of an unpaid order. `node scripts/spree-up.mjs all --reset` restores
  the seed (and issues new API keys).
