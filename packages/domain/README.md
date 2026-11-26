# @instincts/spree-domain

Version-neutral models for Spree Commerce, as zod schemas and TypeScript types. One vocabulary
for orders, payments, fulfillments, products, variants, catalog and customers, whichever Spree
API (4.2 → 6.x) the data came from.

```sh
npm install @instincts/spree-domain zod
```

```ts
import { Order } from '@instincts/spree-domain';

const order = Order.parse(data); // throws on malformed data
console.log(order.number, order.status, order.total.amount, order.total.currency);
```

- **Money** is `{ amount: string; currency: string }`; arithmetic happens in bigint minor units,
  never floats.
- **Unknown states** from newer Spree versions parse as `'unknown'` instead of failing.
- Order statuses follow Spree 6 (`draft`, `placed`, `canceled`, `returned`, with separate
  payment and fulfillment statuses); adapters map older APIs in.

Part of [Spree Admin Native](https://github.com/1instinct/spree-admin-native) and used by
[expo-spree](https://github.com/1instinct/expo-spree). MIT.
