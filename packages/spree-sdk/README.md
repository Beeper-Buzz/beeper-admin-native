# @instincts/spree-sdk

A Spree Commerce admin client that works with Spree 4.2 through 6.x: it finds out which admin
API a store has and talks to it through one interface.

| Spree     | API             | Sign-in                              |
| --------- | --------------- | ------------------------------------ |
| 4.2 – 4.3 | API v1          | Admin API key (`X-Spree-Token`)      |
| 4.4 – 5.x | Platform API v2 | OAuth application                    |
| 5.4 – 6.x | Admin API v3    | Email + password (JWT) or secret key |

```sh
npm install @instincts/spree-sdk @instincts/spree-domain zod
```

See the exported `probeStore`, `createTransport`, the `auth` helpers and `createAdapter`; the
app's tRPC routers (`packages/api/src/routers` in the repo)
show the full sign-in, order, product and customer flows.

- `fetch` is injectable (React Native, tests, servers).
- Errors are `SpreeError` with a `kind` (`auth`, `network`, `invalid`, `rateLimited`…) and the
  store's own message.
- Proven against real Spree 4.2 and 6.0 in Docker.

Part of [Spree Admin Native](https://github.com/1instinct/spree-admin-native). MIT.
