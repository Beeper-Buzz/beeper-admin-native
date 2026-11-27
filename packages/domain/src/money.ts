import { z } from 'zod';

/**
 * Money as Spree sends it: a decimal string and an ISO 4217 currency code.
 * Never a float. Arithmetic happens in bigint minor units.
 */
export const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Expected a decimal string like "19.99"');
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 code like "USD"');

export const Money = z.object({ amount: DecimalString, currency: CurrencyCode });
export type Money = z.infer<typeof Money>;

const exponentCache = new Map<string, number>();

/** Number of minor-unit digits for a currency (USD 2, JPY 0, KWD 3), from Intl. */
export function currencyExponent(currency: string): number {
  let exp = exponentCache.get(currency);
  if (exp === undefined) {
    exp =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ??
      2;
    exponentCache.set(currency, exp);
  }
  return exp;
}

/** Parse a decimal string into bigint units at `exponent` digits, rounding half away from zero. */
function decimalToUnits(amount: string, exponent: number): bigint {
  const parsed = DecimalString.parse(amount);
  const negative = parsed.startsWith('-');
  const [whole = '0', frac = ''] = (negative ? parsed.slice(1) : parsed).split('.');
  const kept = frac.slice(0, exponent).padEnd(exponent, '0');
  let units = BigInt(whole + kept);
  const next = frac.charAt(exponent);
  if (next !== '' && Number(next) >= 5) units += 1n;
  return negative ? -units : units;
}

function unitsToDecimal(units: bigint, exponent: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(exponent + 1, '0');
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const frac = exponent === 0 ? '' : `.${digits.slice(-exponent)}`;
  return `${negative && units !== 0n ? '-' : ''}${whole}${frac}`;
}

/** Build a Money value, normalising the amount to the currency's exponent. */
export function money(amount: string, currency: string): Money {
  const code = CurrencyCode.parse(currency);
  const exp = currencyExponent(code);
  return { amount: unitsToDecimal(decimalToUnits(amount, exp), exp), currency: code };
}

export function toMinorUnits(value: Money): bigint {
  return decimalToUnits(value.amount, currencyExponent(value.currency));
}

export function fromMinorUnits(units: bigint, currency: string): Money {
  return { amount: unitsToDecimal(units, currencyExponent(currency)), currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot combine money in different currencies (${a.currency} and ${b.currency})`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b), a.currency);
}

export function sumMoney(values: readonly Money[], currency: string): Money {
  return values.reduce<Money>((total, v) => addMoney(total, v), money('0', currency));
}

/** A unit price times a whole quantity (a line total). */
export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) throw new Error(`Quantity must be a whole number, got ${quantity}`);
  return fromMinorUnits(toMinorUnits(value) * BigInt(quantity), value.currency);
}

export function negateMoney(value: Money): Money {
  return fromMinorUnits(-toMinorUnits(value), value.currency);
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  const diff = toMinorUnits(a) - toMinorUnits(b);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}

export function isZero(value: Money): boolean {
  return toMinorUnits(value) === 0n;
}

/**
 * Format for display. Goes through Number only at the edge, which is exact for any
 * amount below 2^53 minor units (about 90 trillion dollars).
 */
export function formatMoney(value: Money, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: value.currency }).format(
    Number(value.amount),
  );
}
