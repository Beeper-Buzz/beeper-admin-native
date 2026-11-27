import {
  type Customer,
  displayName,
  formatMoney,
  type Product,
  sellableVariants,
} from '@instincts/spree-domain';
import { radius, space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Button, MoneyText, TextField } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useDebounced } from '@/components/use-debounced';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';
import {
  type AddressField,
  type AddressForm,
  type DraftCustomer,
  type DraftErrors,
  type DraftLine,
  itemsTotal,
  lineFor,
  lineTotal,
} from './draft-form';

function Card({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {children}
    </View>
  );
}

/** A tappable result row inside a card. */
function Choice({
  title,
  subtitle,
  label,
  first,
  disabled,
  onPress,
  trailing,
}: {
  title: string;
  subtitle?: string | null;
  label: string;
  first?: boolean;
  disabled?: boolean;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text size="footnote" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Search customers, or order as a guest under a typed email. */
export function CustomerPicker({
  customer,
  email,
  error,
  onCustomer,
  onGuest,
  onClear,
}: {
  customer: DraftCustomer | null;
  email: string;
  error?: string | null;
  onCustomer: (c: Customer) => void;
  onGuest: (email: string) => void;
  onClear: () => void;
}) {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const results = useQuery({
    ...trpc.customers.list.queryOptions({ perPage: 8, query }),
    enabled: query.length >= 2,
  });

  if (customer || email) {
    return (
      <Card>
        <Choice
          first
          title={customer ? customer.name : 'Guest'}
          subtitle={customer ? (customer.name === customer.email ? null : customer.email) : email}
          label="Change customer"
          onPress={onClear}
          trailing={
            <Text size="footnote" font="uiSemibold" tone="accent">
              Change
            </Text>
          }
        />
      </Card>
    );
  }

  const typedEmail = EMAIL.test(query) ? query : null;
  const items = results.data?.items ?? [];
  return (
    <View style={{ gap: space[2] }}>
      <TextField
        label="Customer"
        value={search}
        onChangeText={setSearch}
        placeholder="Search by email or name, or type a guest's email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        returnKeyType="search"
        error={error}
      />
      {query.length >= 2 ? (
        <Card>
          {results.isPending ? <ActivityIndicator style={{ margin: space[3] }} /> : null}
          {items.map((c, i) => (
            <Choice
              key={c.id}
              first={i === 0}
              title={displayName(c)}
              subtitle={displayName(c) === c.email ? null : c.email}
              label={`Choose ${displayName(c)}`}
              onPress={() => {
                setSearch('');
                onCustomer(c);
              }}
            />
          ))}
          {typedEmail && !items.some((c) => c.email.toLowerCase() === typedEmail.toLowerCase()) ? (
            <Choice
              first={items.length === 0}
              title={`Guest: ${typedEmail}`}
              subtitle="No account; the order goes to this email."
              label={`Order as guest ${typedEmail}`}
              onPress={() => {
                setSearch('');
                onGuest(typedEmail);
              }}
            />
          ) : null}
          {results.error ? (
            <Text tone="critical" style={{ padding: space[3] }}>
              {results.error.message} Type a full email to order as a guest.
            </Text>
          ) : results.isSuccess && items.length === 0 && !typedEmail ? (
            <Text tone="muted" style={{ padding: space[3] }}>
              No customers match. Type a full email to order as a guest.
            </Text>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

const stockText = (v: { totalOnHand: number | null }) =>
  v.totalOnHand === null ? null : v.totalOnHand > 0 ? `${v.totalOnHand} in stock` : 'Out of stock';

/** Search active products and add a variant. */
export function ItemPicker({ onAdd }: { onAdd: (line: DraftLine) => void }) {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const query = useDebounced(search.trim());
  const results = useQuery({
    ...trpc.products.list.queryOptions({ perPage: 10, status: 'active', query }),
    enabled: query.length >= 2,
  });
  const add = (p: Product, variantId: string) => {
    const v = p.variants.find((x) => x.id === variantId);
    if (!v) return;
    onAdd(lineFor(p, v));
    setSearch('');
    setOpen(null);
  };

  return (
    <View style={{ gap: space[2] }}>
      <TextField
        label="Add products"
        value={search}
        onChangeText={(t) => {
          setSearch(t);
          setOpen(null);
        }}
        placeholder="Search by name or SKU"
        autoCorrect={false}
        returnKeyType="search"
      />
      {query.length >= 2 ? (
        <Card>
          {results.isPending ? <ActivityIndicator style={{ margin: space[3] }} /> : null}
          {results.error ? (
            <Text tone="critical" style={{ padding: space[3] }}>
              {results.error.message}
            </Text>
          ) : null}
          {results.data?.items.length === 0 ? (
            <Text tone="muted" style={{ padding: space[3] }}>
              No active products match “{query}”.
            </Text>
          ) : null}
          {results.data?.items.map((p, i) => {
            const variants = sellableVariants(p);
            const single = variants.length === 1 ? variants[0] : undefined;
            const price = single?.price ?? variants.find((v) => v.price)?.price ?? null;
            return (
              <View key={p.id}>
                <Choice
                  first={i === 0}
                  title={p.name}
                  subtitle={
                    single
                      ? [single.sku, stockText(single)].filter(Boolean).join(' · ')
                      : `${variants.length} variants`
                  }
                  label={single ? `Add ${p.name}` : `Show variants of ${p.name}`}
                  onPress={() => (single ? add(p, single.id) : setOpen(open === p.id ? null : p.id))}
                  trailing={price ? <MoneyText value={price} /> : null}
                />
                {open === p.id
                  ? variants.map((v) => (
                      <Choice
                        key={v.id}
                        title={v.optionsText ?? v.sku ?? 'Variant'}
                        subtitle={[v.sku, stockText(v)].filter(Boolean).join(' · ')}
                        label={`Add ${p.name}, ${v.optionsText ?? v.sku ?? 'variant'}`}
                        onPress={() => add(p, v.id)}
                        trailing={v.price ? <MoneyText value={v.price} /> : null}
                      />
                    ))
                  : null}
              </View>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}

/** The order's lines with quantity steppers, line totals and the items subtotal. */
export function LineEditor({
  lines,
  error,
  onQuantity,
}: {
  lines: readonly DraftLine[];
  error?: string | null;
  onQuantity: (variantId: string, quantity: number) => void;
}) {
  const { colors } = useTheme();
  if (lines.length === 0)
    return (
      <Text size="footnote" tone={error ? 'critical' : 'muted'}>
        {error ?? 'No products yet.'}
      </Text>
    );
  const subtotal = itemsTotal(lines);
  return (
    <Card>
      {lines.map((l, i) => {
        const total = lineTotal(l);
        const label = [l.name, l.optionsText].filter(Boolean).join(', ');
        return (
          <View
            key={l.variantId}
            style={[
              styles.line,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={2}>{l.name}</Text>
              <Text size="caption" font="mono" tone="muted">
                {[l.optionsText, l.price ? `${formatMoney(l.price)} each` : null].filter(Boolean).join(' · ')}
              </Text>
              <View style={styles.stepper}>
                <Button
                  title={l.quantity === 1 ? 'Remove' : '−'}
                  size="small"
                  variant="tonal"
                  accessibilityLabel={l.quantity === 1 ? `Remove ${label}` : `One fewer ${label}`}
                  onPress={() => onQuantity(l.variantId, l.quantity - 1)}
                />
                <Text font="monoMedium" accessibilityLabel={`Quantity of ${label}: ${l.quantity}`}>
                  {l.quantity}
                </Text>
                <Button
                  title="+"
                  size="small"
                  variant="tonal"
                  accessibilityLabel={`One more ${label}`}
                  onPress={() => onQuantity(l.variantId, l.quantity + 1)}
                />
              </View>
            </View>
            {total ? <MoneyText value={total} /> : null}
          </View>
        );
      })}
      {subtotal ? (
        <View
          style={[styles.line, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}
        >
          <Text font="uiSemibold" style={{ flex: 1 }}>
            Items
          </Text>
          <MoneyText value={subtotal} />
        </View>
      ) : null}
    </Card>
  );
}

const ADDRESS_LABELS: [AddressField, string, Partial<React.ComponentProps<typeof TextField>>][] = [
  ['firstName', 'First name', { autoComplete: 'given-name', textContentType: 'givenName' }],
  ['lastName', 'Last name', { autoComplete: 'family-name', textContentType: 'familyName' }],
  ['company', 'Company (optional)', { textContentType: 'organizationName' }],
  ['address1', 'Street address', { autoComplete: 'address-line1', textContentType: 'streetAddressLine1' }],
  ['address2', 'Apartment, suite (optional)', { textContentType: 'streetAddressLine2' }],
  ['city', 'City', { textContentType: 'addressCity' }],
  ['stateCode', 'State or province', { autoCapitalize: 'characters', placeholder: 'OR' }],
  ['zipcode', 'ZIP or postal code', { autoComplete: 'postal-code', textContentType: 'postalCode' }],
  ['countryIso', 'Country code', { autoCapitalize: 'characters', maxLength: 2, placeholder: 'US' }],
  ['phone', 'Phone', { keyboardType: 'phone-pad', textContentType: 'telephoneNumber' }],
];

/** The address fields; `prefix` names them for screen readers ("Shipping first name"). */
export function AddressFields({
  title,
  value,
  errors,
  prefix,
  onChange,
}: {
  title: string;
  value: AddressForm;
  errors: DraftErrors;
  prefix: 'ship' | 'bill';
  onChange: (next: AddressForm) => void;
}) {
  const name = prefix === 'ship' ? 'Shipping' : 'Billing';
  return (
    <View style={{ gap: space[3] }}>
      <Label>{title}</Label>
      {ADDRESS_LABELS.map(([field, label, props]) => (
        <TextField
          key={field}
          label={label}
          accessibilityLabel={`${name} ${label.toLowerCase()}`}
          value={value[field]}
          onChangeText={(t) => onChange({ ...value, [field]: t })}
          error={errors[`${prefix}.${field}`] ?? null}
          autoCorrect={false}
          {...props}
        />
      ))}
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, overflow: 'hidden' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], minHeight: 44 },
  line: { flexDirection: 'row', gap: space[3], padding: space[3], alignItems: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[1] },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
