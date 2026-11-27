const MESSAGES: Record<string, string> = {
  'orders.read': "This store's API doesn't allow reading orders with your account.",
  'orders.create': 'Creating orders from the app needs Spree 4.2–4.3 (API v1) or Spree 5.4+.',
  'products.read': "This store's API doesn't allow reading products with your account.",
  'products.write': "This store's API doesn't allow editing products with your account.",
  'products.media': "This store's API doesn't allow managing product photos with your account.",
  'media.library': "This store's API can't list its product images in one place.",
  'inventory.adjust': "This store's API doesn't allow changing stock with your account.",
  'inventory.lowStock':
    "This store can't list low-stock products (Spree 4.2–5.3 needs the companion gem 0.3).",
  'customers.read': "This store's API doesn't allow reading customers with your account.",
  'orders.capture': 'Capturing payments from the app needs Spree 5.4+ or the companion gem.',
  'orders.refund': 'Refunds from the app need Spree 5.4+ or the companion gem.',
  'orders.note': 'Order notes need Spree 5.4+ or the companion gem.',
  'analytics.summary': 'Sales summaries need Spree 5.4+ or the companion gem.',
  'notifications.push': 'Push notifications need the companion gem, or Spree webhooks with the relay.',
  'admin.resources': "This store doesn't describe any admin types (companion gem 0.4 with registered types).",
  'webhooks.manage': "This store's Spree version doesn't support webhooks.",
};

export function capabilityMessage(capability: string): string {
  return MESSAGES[capability] ?? `This store doesn't support "${capability}" yet.`;
}
