import type { AdminField } from '@instincts/spree-domain';
import { serverFieldErrors } from './values';

/** The store's refusal as the forms show it: per field, and general ones (`base`) above the form. */
export type ServerErrors = ReturnType<typeof serverFieldErrors>;
export const NO_ERRORS: ServerErrors = { byField: {}, general: [] };

/** A tRPC mutation error, with the SpreeError kind and per-field errors the router adds. */
export interface MutationError {
  message: string;
  data?: { spreeKind?: string | null; fieldErrors?: Record<string, string[]> | null } | null;
}

/** A stale save (gem 0.5 409): someone else changed the record since the form loaded it. */
export const isConflict = (e: MutationError): boolean => e.data?.spreeKind === 'conflict';

/**
 * Errors for a form of `fields`. With `fallback`, a refusal that names no field (or nothing at all)
 * shows its message as a general error, for forms that have no other place for it.
 */
export function formErrors(fields: AdminField[], e: MutationError, fallback = false): ServerErrors {
  const errors = serverFieldErrors(fields, e.data?.fieldErrors);
  if (fallback && !errors.general.length && !Object.keys(errors.byField).length)
    return { byField: {}, general: [e.message] };
  return errors;
}
