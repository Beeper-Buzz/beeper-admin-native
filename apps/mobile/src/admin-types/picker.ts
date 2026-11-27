import type { AdminReference } from '@instincts/spree-domain';
import { router } from 'expo-router';

/**
 * The reference picker is a form-sheet route, so the form hands it a callback by request id
 * instead of a prop. A pick resolves the callback; closing the sheet just forgets it.
 */
type Pick = (choice: AdminReference | null) => void;
const pending = new Map<string, Pick>();
let next = 0;

export function openReferencePicker(
  options: { resource: string; label: string; selected: string | null; optional: boolean },
  onPick: Pick,
): string {
  next += 1;
  const request = `pick-${next}`;
  pending.set(request, onPick);
  router.push({
    pathname: '/more/admin/pick',
    params: {
      resource: options.resource,
      label: options.label,
      request,
      selected: options.selected ?? '',
      optional: options.optional ? '1' : '',
    },
  });
  return request;
}

/** Called by the picker sheet; false when the form that asked is gone. */
export function resolvePick(request: string, choice: AdminReference | null): boolean {
  const onPick = pending.get(request);
  pending.delete(request);
  onPick?.(choice);
  return !!onPick;
}

export function forgetPick(request: string): void {
  pending.delete(request);
}
