import type { AdminFilter, AdminReference, AdminResource } from '@instincts/spree-domain';
import type { AdminFilterValue } from '@instincts/spree-sdk';
import { isDay } from './values';

/**
 * List filters of a host-described type. Gem 0.4 filters (and 0.5 `enum` ones) are chips from
 * their options; gem 0.5 adds `reference` (a record of another type), `presence` (set or not set)
 * and `date_range` (from and to days).
 */
export const ANY = '*';

export interface DateRangeDraft {
  from: string;
  to: string;
}
/** What the list screen holds per filter: a chip's key, a picked record or typed days. */
export type FilterChoice = string | AdminReference | DateRangeDraft;
export type FilterChoices = Record<string, FilterChoice>;

export type FilterKind = 'chips' | 'presence' | 'reference' | 'date_range';

export const PRESENCE_CHIPS = [
  [ANY, 'Any'],
  ['set', 'Set'],
  ['unset', 'Not set'],
] as const;

/**
 * How the app offers a filter, or null when it can't: chips need options, and a reference needs
 * its target type in the manifest (hidden ones count) so the picker can list it.
 */
export function filterKind(filter: AdminFilter, types: readonly AdminResource[]): FilterKind | null {
  switch (filter.type) {
    case 'presence':
      return 'presence';
    case 'date_range':
      return 'date_range';
    case 'reference':
      return filter.resource && types.some((t) => t.key === filter.resource) ? 'reference' : null;
    default:
      // `enum`, a 0.4 filter and a type this app doesn't know: chips, as in 0.4.
      return filter.options.length ? 'chips' : null;
  }
}

export const isRangeDraft = (c: FilterChoice | undefined): c is DateRangeDraft =>
  typeof c === 'object' && c !== null && 'from' in c;
export const isReferenceChoice = (c: FilterChoice | undefined): c is AdminReference =>
  typeof c === 'object' && c !== null && 'id' in c;

/** A message for one end of a date range, or null when it's empty or a real day. */
export function dayError(text: string): string | null {
  return !text.trim() || isDay(text) ? null : 'Use YYYY-MM-DD.';
}

/** Messages for a range's From and To; To before From is an error on To. */
export function rangeErrors(range: DateRangeDraft): { from: string | null; to: string | null } {
  const from = dayError(range.from);
  const to = dayError(range.to);
  if (!from && !to && range.from.trim() && range.to.trim() && range.to.trim() < range.from.trim())
    return { from, to: 'To is before From.' };
  return { from, to };
}

/** The chosen filters as the store's values, skipping "Any", empty ranges and unfinished days. */
export function filterValues(
  filters: readonly AdminFilter[],
  choices: FilterChoices,
  types: readonly AdminResource[],
): Record<string, Exclude<AdminFilterValue, null>> {
  const out: Record<string, Exclude<AdminFilterValue, null>> = {};
  for (const f of filters) {
    const kind = filterKind(f, types);
    const choice = choices[f.name];
    if (!kind || choice === undefined || choice === ANY) continue;
    if (kind === 'chips' && typeof choice === 'string') {
      const option = f.options.find((o) => String(o.value) === choice);
      if (option) out[f.name] = option.value;
    } else if (kind === 'presence' && (choice === 'set' || choice === 'unset')) {
      out[f.name] = choice;
    } else if (kind === 'reference' && isReferenceChoice(choice)) {
      out[f.name] = choice.id;
    } else if (kind === 'date_range' && isRangeDraft(choice)) {
      const errors = rangeErrors(choice);
      if (errors.from || errors.to) continue;
      const range: { from?: string; to?: string } = {};
      if (choice.from.trim()) range.from = choice.from.trim();
      if (choice.to.trim()) range.to = choice.to.trim();
      if (range.from || range.to) out[f.name] = range;
    }
  }
  return out;
}
