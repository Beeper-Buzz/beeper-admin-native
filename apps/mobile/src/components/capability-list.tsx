import { space } from '@instincts/spree-ui';
import { View } from 'react-native';
import { Label, Text } from './text';

/** Plain-words names for what the merchant can do. Grouped so the list reads as features, not API names. */
const GROUPS: { title: string; items: [capability: string, label: string][] }[] = [
  {
    title: 'Orders',
    items: [
      ['orders.read', 'View orders'],
      ['orders.create', 'Create orders'],
      ['shipments.ship', 'Mark shipped'],
      ['orders.capture', 'Capture payments'],
      ['orders.refund', 'Refund'],
      ['orders.cancel', 'Cancel'],
    ],
  },
  {
    title: 'Catalog',
    items: [
      ['products.read', 'View products'],
      ['products.write', 'Edit products'],
      ['inventory.adjust', 'Adjust stock'],
      ['products.media', 'Product photos'],
      ['media.library', 'Media library'],
    ],
  },
  {
    title: 'More',
    items: [
      ['customers.read', 'Customers'],
      ['inbox', 'Customer inbox'],
      ['visitors', 'Live visitors'],
      ['carts', 'Carts'],
      ['promotions.read', 'Promotions'],
      ['analytics.summary', 'Sales summary'],
      ['notifications.push', 'Push notifications'],
      ['admin.resources', 'Store admin types'],
    ],
  },
];

export function CapabilityList({ capabilities }: { capabilities: readonly string[] }) {
  const has = new Set(capabilities);
  return (
    <View style={{ gap: space[3] }}>
      {GROUPS.map((g) => (
        <View key={g.title} style={{ gap: space[1] }}>
          <Label>{g.title}</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space[4], rowGap: space[1] }}>
            {g.items.map(([cap, label]) => (
              <Text
                key={cap}
                size="footnote"
                tone={has.has(cap) ? 'ink' : 'muted'}
                accessibilityLabel={`${label}: ${has.has(cap) ? 'available' : 'not available'}`}
              >
                {has.has(cap) ? '✓ ' : '– '}
                {label}
              </Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
