import type { Promotion } from '@instincts/spree-domain';

export type Kind = 'percent' | 'fixed';

/** The promotion editor's form: text fields as typed, converted on save. */
export interface Form {
  name: string;
  code: string;
  kind: Kind;
  amount: string;
  startsOn: string;
  endsOn: string;
  usageLimit: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

/** ISO timestamp → local YYYY-MM-DD for the form. */
export function toDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Starts at the beginning of the local day, ends at its last second. */
export function fromDay(day: string, edge: 'start' | 'end'): string | null {
  if (!day) return null;
  return new Date(`${day}T${edge === 'start' ? '00:00:00' : '23:59:59'}`).toISOString();
}

export function formFor(p: Promotion | undefined): Form {
  const d = p?.discount;
  return {
    name: p?.name ?? '',
    code: p?.code?.toUpperCase() ?? '',
    kind: d?.type === 'fixed' ? 'fixed' : 'percent',
    amount: d && d.type !== 'other' ? d.amount : '',
    startsOn: toDay(p?.startsAt ?? null),
    endsOn: toDay(p?.expiresAt ?? null),
    usageLimit: p?.usageLimit ? String(p.usageLimit) : '',
  };
}

/** Field errors, keyed by field; empty when the form can be saved. */
export function validate(f: Form, editableDiscount: boolean): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!f.name.trim()) e.name = 'Give it a name.';
  if (f.code && !/^[A-Za-z0-9_-]+$/.test(f.code.trim()))
    e.code = 'Use letters, numbers, dashes or underscores.';
  if (editableDiscount) {
    const a = f.amount.trim().replace(',', '.');
    if (!AMOUNT.test(a) || Number(a) <= 0) e.amount = 'Enter a number like 10 or 12.50.';
    else if (f.kind === 'percent' && Number(a) > 100) e.amount = 'A percentage can be at most 100.';
  }
  if (f.startsOn && !DATE.test(f.startsOn)) e.startsOn = 'Use YYYY-MM-DD.';
  if (f.endsOn && !DATE.test(f.endsOn)) e.endsOn = 'Use YYYY-MM-DD.';
  if (!e.startsOn && !e.endsOn && f.startsOn && f.endsOn && f.endsOn < f.startsOn)
    e.endsOn = 'Ends before it starts.';
  if (f.usageLimit && !/^[1-9]\d*$/.test(f.usageLimit.trim()))
    e.usageLimit = 'A whole number, or leave empty.';
  return e;
}
