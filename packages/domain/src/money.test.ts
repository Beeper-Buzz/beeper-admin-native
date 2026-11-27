import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  formatMoney,
  Money,
  money,
  multiplyMoney,
  negateMoney,
  sumMoney,
  toMinorUnits,
} from './money';

describe('Money', () => {
  it('parses Spree decimal strings without float drift', () => {
    expect(Money.parse({ amount: '19.99', currency: 'USD' })).toEqual({ amount: '19.99', currency: 'USD' });
  });

  it('rejects numbers and malformed amounts', () => {
    expect(() => Money.parse({ amount: 19.99, currency: 'USD' })).toThrow();
    expect(() => Money.parse({ amount: '19,99', currency: 'USD' })).toThrow();
    expect(() => Money.parse({ amount: '1', currency: 'usd' })).toThrow();
  });

  it('normalises amounts to the currency exponent', () => {
    expect(money('1234.5', 'USD')).toEqual({ amount: '1234.50', currency: 'USD' });
    expect(money('500', 'JPY')).toEqual({ amount: '500', currency: 'JPY' });
    expect(money('-3.1', 'EUR')).toEqual({ amount: '-3.10', currency: 'EUR' });
  });

  it('converts to minor units as bigint', () => {
    expect(toMinorUnits(money('0.10', 'USD'))).toBe(10n);
    expect(toMinorUnits(money('1.005', 'USD'))).toBe(101n); // half away from zero
  });

  it('adds in minor units', () => {
    expect(addMoney(money('0.10', 'USD'), money('0.20', 'USD'))).toEqual(money('0.30', 'USD'));
  });

  it('sums a list, with an explicit currency for empty lists', () => {
    expect(sumMoney([money('1', 'USD'), money('2.50', 'USD')], 'USD')).toEqual(money('3.50', 'USD'));
    expect(sumMoney([], 'EUR')).toEqual(money('0', 'EUR'));
  });

  it('refuses to mix currencies', () => {
    expect(() => addMoney(money('1', 'USD'), money('1', 'EUR'))).toThrow(/different currencies/);
  });

  it('negates and compares', () => {
    expect(negateMoney(money('4', 'USD'))).toEqual(money('-4', 'USD'));
    expect(compareMoney(money('4', 'USD'), money('3.99', 'USD'))).toBe(1);
    expect(compareMoney(money('4', 'USD'), money('4.00', 'USD'))).toBe(0);
  });

  it('formats with Intl', () => {
    expect(formatMoney(money('1234.5', 'USD'), 'en-US')).toBe('$1,234.50');
    expect(formatMoney(money('-42', 'USD'), 'en-US')).toBe('-$42.00');
    expect(formatMoney(money('1234.5', 'EUR'), 'de-DE')).toBe('1.234,50\u00a0€');
  });

  it('multiplies a unit price by a quantity in minor units', () => {
    expect(multiplyMoney(money('19.99', 'USD'), 3)).toEqual({ amount: '59.97', currency: 'USD' });
    expect(multiplyMoney(money('0.10', 'USD'), 0)).toEqual({ amount: '0.00', currency: 'USD' });
    expect(multiplyMoney(money('500', 'JPY'), 2)).toEqual({ amount: '1000', currency: 'JPY' });
    expect(() => multiplyMoney(money('1', 'USD'), 1.5)).toThrow();
  });
});
