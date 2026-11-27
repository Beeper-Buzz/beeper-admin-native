import type { AdminActionResult } from '@instincts/spree-domain';
import { router } from 'expo-router';

/**
 * An action with inputs (gem 0.5) runs from a form-sheet route, so the record form hands it a
 * callback by request id, as the reference picker does. The sheet runs the action and shows its
 * errors; a result goes to the callback. Closing the sheet just forgets it.
 */
type Done = (result: AdminActionResult) => void;
const pending = new Map<string, Done>();
let next = 0;

export function openActionSheet(options: { key: string; id: string; action: string }, onDone: Done): string {
  next += 1;
  const request = `action-${next}`;
  pending.set(request, onDone);
  router.push({ pathname: '/more/admin/action', params: { ...options, request } });
  return request;
}

/** Called by the sheet with the action's result; false when the form that asked is gone. */
export function resolveAction(request: string, result: AdminActionResult): boolean {
  const onDone = pending.get(request);
  pending.delete(request);
  onDone?.(result);
  return !!onDone;
}

export function forgetAction(request: string): void {
  pending.delete(request);
}
