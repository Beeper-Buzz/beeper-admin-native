import {
  type Address,
  type Customer,
  displayName,
  type Money,
  multiplyMoney,
  type Order,
  type Product,
  sumMoney,
  type Variant,
} from '@instincts/spree-domain';

/** Address fields in the order the form shows them. */
export const ADDRESS_FIELDS = [
  'firstName',
  'lastName',
  'company',
  'address1',
  'address2',
  'city',
  'stateCode',
  'zipcode',
  'countryIso',
  'phone',
] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];
/** An address as typed: every field a string. */
export type AddressForm = Record<AddressField, string>;

const REQUIRED: Partial<Record<AddressField, string>> = {
  firstName: 'Enter a first name.',
  lastName: 'Enter a last name.',
  address1: 'Enter a street address.',
  city: 'Enter a city.',
  countryIso: 'Use a two-letter country code like US.',
};

export interface DraftLine {
  variantId: string;
  name: string;
  optionsText: string | null;
  sku: string | null;
  /** Unit price; null when the store sent none (the server prices it). */
  price: Money | null;
  quantity: number;
}

export interface DraftCustomer {
  id: string;
  email: string;
  name: string;
}

/** The new-order form. `customer: null` is a guest order under `email`. */
export interface DraftForm {
  customer: DraftCustomer | null;
  email: string;
  lines: DraftLine[];
  ship: AddressForm;
  billSame: boolean;
  bill: AddressForm;
}

export type DraftErrors = Partial<
  Record<'email' | 'lines' | `ship.${AddressField}` | `bill.${AddressField}`, string>
>;

export function emptyAddress(countryIso = 'US'): AddressForm {
  const a = Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, ''])) as AddressForm;
  return { ...a, countryIso };
}

export function addressForm(a: Address | null | undefined, countryIso = 'US'): AddressForm {
  if (!a) return emptyAddress(countryIso);
  return {
    firstName: a.firstName ?? '',
    lastName: a.lastName ?? '',
    company: a.company ?? '',
    address1: a.address1,
    address2: a.address2 ?? '',
    city: a.city,
    stateCode: a.stateCode ?? a.stateName ?? '',
    zipcode: a.zipcode ?? '',
    countryIso: a.countryIso,
    phone: a.phone ?? '',
  };
}

export function emptyForm(): DraftForm {
  return { customer: null, email: '', lines: [], ship: emptyAddress(), billSame: true, bill: emptyAddress() };
}

const isBlank = (a: AddressForm) => ADDRESS_FIELDS.every((f) => f === 'countryIso' || !a[f].trim());
const sameAddress = (a: AddressForm, b: AddressForm) =>
  ADDRESS_FIELDS.every((f) => a[f].trim() === b[f].trim());

/** A draft read back from the store, for editing. */
export function formFromOrder(order: Order): DraftForm {
  const ship = addressForm(order.shipAddress);
  const bill = addressForm(order.billAddress);
  return {
    customer: order.customer
      ? { id: order.customer.id, email: order.customer.email, name: order.customer.email }
      : null,
    email: order.email ?? '',
    lines: order.lineItems.map((li) => ({
      variantId: li.variantId,
      name: li.name,
      optionsText: li.optionsText,
      sku: li.sku,
      price: li.price,
      quantity: li.quantity,
    })),
    ship,
    billSame: !order.billAddress || sameAddress(ship, bill),
    bill,
  };
}

/** Choose a customer: their email, and their saved address unless one is already typed. */
export function withCustomer(form: DraftForm, c: Customer): DraftForm {
  const saved = addressForm(c.defaultAddress);
  return {
    ...form,
    customer: { id: c.id, email: c.email, name: displayName(c) },
    email: c.email,
    ship: c.defaultAddress && isBlank(form.ship) ? saved : form.ship,
    bill: c.defaultAddress && isBlank(form.bill) ? saved : form.bill,
  };
}

export function asGuest(form: DraftForm, email: string): DraftForm {
  return { ...form, customer: null, email: email.trim() };
}

export function lineFor(product: Pick<Product, 'name'>, v: Variant): DraftLine {
  return {
    variantId: v.id,
    name: product.name,
    optionsText: v.optionsText,
    sku: v.sku,
    price: v.price,
    quantity: 1,
  };
}

/** Adds a line, or one more of a variant already in the order. */
export function addLine(form: DraftForm, line: DraftLine): DraftForm {
  const existing = form.lines.find((l) => l.variantId === line.variantId);
  if (existing) return setQuantity(form, line.variantId, existing.quantity + line.quantity);
  return { ...form, lines: [...form.lines, line] };
}

/** Quantity 0 removes the line. */
export function setQuantity(form: DraftForm, variantId: string, quantity: number): DraftForm {
  const q = Math.max(0, Math.floor(quantity));
  return {
    ...form,
    lines: q
      ? form.lines.map((l) => (l.variantId === variantId ? { ...l, quantity: q } : l))
      : form.lines.filter((l) => l.variantId !== variantId),
  };
}

export function lineTotal(line: DraftLine): Money | null {
  return line.price ? multiplyMoney(line.price, line.quantity) : null;
}

/** Sum of the line totals in one currency; null when a price is missing or currencies differ. */
export function itemsTotal(lines: readonly DraftLine[]): Money | null {
  const totals = lines.map(lineTotal);
  const first = totals[0];
  if (!first || totals.some((t) => !t || t.currency !== first.currency)) return null;
  return sumMoney(totals as Money[], first.currency);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate(form: DraftForm): DraftErrors {
  const e: DraftErrors = {};
  if (!EMAIL.test(form.email.trim())) e.email = 'Choose a customer or enter an email like name@example.com.';
  if (form.lines.length === 0) e.lines = 'Add at least one product.';
  const check = (prefix: 'ship' | 'bill', a: AddressForm) => {
    for (const [field, message] of Object.entries(REQUIRED) as [AddressField, string][]) {
      const v = a[field].trim();
      if (!v || (field === 'countryIso' && !/^[A-Za-z]{2}$/.test(v))) e[`${prefix}.${field}`] = message;
    }
  };
  check('ship', form.ship);
  if (!form.billSame) check('bill', form.bill);
  return e;
}

function toAddress(a: AddressForm) {
  const t = (f: AddressField) => a[f].trim();
  const opt = (f: AddressField) => t(f) || null;
  return {
    firstName: t('firstName'),
    lastName: t('lastName'),
    company: opt('company'),
    address1: t('address1'),
    address2: opt('address2'),
    city: t('city'),
    zipcode: opt('zipcode'),
    phone: opt('phone'),
    stateCode: opt('stateCode')?.toUpperCase() ?? null,
    stateName: null,
    countryIso: t('countryIso').toUpperCase(),
  };
}

/** What the `orders.createDraft` / `orders.updateDraft` procedures take. */
export function toDraftInput(form: DraftForm) {
  return {
    customerId: form.customer?.id ?? null,
    email: form.email.trim(),
    items: form.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    shipAddress: toAddress(form.ship),
    billAddress: form.billSame ? null : toAddress(form.bill),
  };
}

/** "Ada Lovelace, 1 Main St, Portland OR 97201, US" for the review screen. */
export function addressLine(a: Address | null): string {
  if (!a) return '';
  return [
    [a.firstName, a.lastName].filter(Boolean).join(' '),
    a.company,
    [a.address1, a.address2].filter(Boolean).join(', '),
    [a.city, a.stateCode ?? a.stateName, a.zipcode].filter(Boolean).join(' '),
    a.countryIso,
  ]
    .filter(Boolean)
    .join('\n');
}
