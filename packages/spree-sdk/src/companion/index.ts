import { type ManualPaymentMethod, money, StoreSummary } from '@instincts/spree-domain';
import { SpreeError } from '../errors';
import type { Transport } from '../transport';

/** Client for the optional `spree_admin_native` gem (gems/spree_admin_native). */
const BASE = '/api/admin_native/v1';

export interface PairingResult {
  token: string;
  device: { id: string; name: string; platform: string | null };
  user: { email: string | null };
}

export interface CompanionRefund {
  id: string;
  amount: string;
  reason: string | null;
  paymentNumber: string;
}

export interface CompanionPort {
  summary(): Promise<StoreSummary>;
  refundReasons(): Promise<{ id: string; name: string }[]>;
  /** Gem 0.3+: products with low-stock variants, lowest first. */
  lowStockProducts(
    page: number,
    perPage: number,
  ): Promise<{
    rows: { productId: string; lowVariants: number; lowestOnHand: number }[];
    totalCount: number;
    threshold: number;
  }>;
  /** Spree 4.2–4.3: API v1 has no working refund action. */
  refund(input: {
    orderNumber: string;
    paymentNumber: string;
    amount: string;
    reasonId?: string | null;
  }): Promise<CompanionRefund>;
  updateCurrentDevice(patch: { pushToken?: string | null; pushEnabled?: boolean }): Promise<void>;
  /** Spree 4.2–4.3: payment methods that need no source (API v1 doesn't say which do). Gem 0.3+. */
  manualPaymentMethods(): Promise<ManualPaymentMethod[]>;
  /** Spree 4.2–4.3: delete an incomplete order (API v1 has no destroy). Gem 0.3+. */
  discardDraft(orderNumber: string): Promise<void>;
}

/** What a scanned QR code holds: `https://store/api/admin_native/v1/pair?code=ABCD…`. */
export function parsePairingPayload(value: string): { url: string; code: string } | null {
  try {
    const u = new URL(value.trim());
    const code = u.searchParams.get('code');
    if (!code || !u.pathname.endsWith(`${BASE}/pair`)) return null;
    return { url: u.origin, code };
  } catch {
    return null;
  }
}

/** Trade a one-time code for a device token. Unauthenticated. */
export async function exchangePairingCode(
  transport: Transport,
  input: { code: string; deviceName: string; platform?: string },
): Promise<PairingResult> {
  try {
    const res = await transport.request<PairingResult>({
      method: 'POST',
      path: `${BASE}/pairings/exchange`,
      auth: 'none',
      body: { code: input.code, device_name: input.deviceName, platform: input.platform },
    });
    return res.data;
  } catch (e) {
    if (e instanceof SpreeError && e.status === 422) {
      throw new SpreeError({ kind: 'invalid', status: 422, body: e.body, message: e.message });
    }
    throw e;
  }
}

interface SummaryBody {
  currency: string;
  time_zone: string | null;
  today: { orders: number; sales: string };
  orders_to_fulfill: number;
  payments_due: number;
  low_stock_variants: number;
  generated_at: string;
}

/** `transport` must carry auth (device token or admin API key). */
export function companion(transport: Transport): CompanionPort {
  return {
    async summary() {
      const { data: b } = await transport.request<SummaryBody>({ path: `${BASE}/summary` });
      return StoreSummary.parse({
        currency: b.currency,
        timeZone: b.time_zone,
        today: { orders: b.today.orders, sales: money(b.today.sales, b.currency) },
        ordersToFulfill: b.orders_to_fulfill,
        paymentsDue: b.payments_due,
        lowStockVariants: b.low_stock_variants,
        generatedAt: b.generated_at,
      });
    },
    async lowStockProducts(page, perPage) {
      const { data } = await transport.request<{
        data: { product_id: string; low_variants: number; lowest_on_hand: number }[];
        meta: { total_count: number; threshold: number };
      }>({ path: `${BASE}/low_stock`, query: { page, per_page: perPage } });
      return {
        rows: data.data.map((r) => ({
          productId: r.product_id,
          lowVariants: r.low_variants,
          lowestOnHand: r.lowest_on_hand,
        })),
        totalCount: data.meta.total_count,
        threshold: data.meta.threshold,
      };
    },
    async refundReasons() {
      const { data } = await transport.request<{ data: { id: string; name: string }[] }>({
        path: `${BASE}/refund_reasons`,
      });
      return data.data;
    },
    async refund(input) {
      const body: Record<string, unknown> = { amount: input.amount };
      if (input.reasonId) body.reason_id = input.reasonId;
      const { data } = await transport.request<{
        refund: { id: string; amount: string; reason: string | null; payment_number: string };
      }>({
        method: 'POST',
        path: `${BASE}/orders/${encodeURIComponent(input.orderNumber)}/payments/${encodeURIComponent(input.paymentNumber)}/refunds`,
        body,
      });
      const r = data.refund;
      return { id: r.id, amount: r.amount, reason: r.reason, paymentNumber: r.payment_number };
    },
    async updateCurrentDevice(patch) {
      const body: Record<string, unknown> = {};
      if (patch.pushToken !== undefined) body.push_token = patch.pushToken;
      if (patch.pushEnabled !== undefined) body.push_enabled = patch.pushEnabled;
      await transport.request({ method: 'PATCH', path: `${BASE}/devices/current`, body });
    },
    async manualPaymentMethods() {
      const { data } = await transport.request<{
        data: { id: string; name: string; description: string | null }[];
      }>({ path: `${BASE}/payment_methods` });
      return data.data.map((m) => ({ id: m.id, name: m.name, description: m.description || null }));
    },
    async discardDraft(orderNumber) {
      await transport.request({
        method: 'DELETE',
        path: `${BASE}/orders/${encodeURIComponent(orderNumber)}`,
      });
    },
  };
}
