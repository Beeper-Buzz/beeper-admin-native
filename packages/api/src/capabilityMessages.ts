const MESSAGES: Record<string, string> = {
  'orders.read': "This store's API doesn't allow reading orders with your account.",
  'products.read': "This store's API doesn't allow reading products with your account.",
  'products.write': "This store's API doesn't allow editing products with your account.",
  'inventory.adjust': "This store's API doesn't allow changing stock with your account.",
  'customers.read': "This store's API doesn't allow reading customers with your account.",
  'orders.capture': 'Capturing payments from the app needs Spree 5.4+ or the companion gem.',
  'orders.refund': 'Refunds from the app need Spree 5.4+ or the companion gem.',
  'orders.note': 'Order notes need Spree 5.4+ or the companion gem.',
  'analytics.summary': 'Sales summaries need Spree 5.4+ or the companion gem.',
  'notifications.push': 'Push notifications need the companion gem, or Spree webhooks with the relay.',
  'webhooks.manage': "This store's Spree version doesn't support webhooks.",
};

export function capabilityMessage(capability: string): string {
  return MESSAGES[capability] ?? `This store doesn't support "${capability}" yet.`;
}
