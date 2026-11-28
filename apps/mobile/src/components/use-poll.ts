import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Whether the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => setActive(next === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * Calls `tick` every `intervalMs` while `enabled` and the app is in the foreground. Never overlaps:
 * the next wait starts when the previous call settles, so a slow store is never asked twice at
 * once. Paused in the background; coming back runs it straight away when a tick is overdue, then
 * on the interval again. Errors are the caller's to handle; they don't stop the polling.
 */
export function usePoll(tick: () => Promise<unknown> | unknown, intervalMs: number, enabled = true): void {
  const active = useAppActive();
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const lastRun = useRef(Date.now());

  useEffect(() => {
    if (!enabled || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (cancelled) return;
      lastRun.current = Date.now();
      try {
        await tickRef.current();
      } catch {
        // The screen shows its own errors; polling carries on.
      }
      if (!cancelled) timer = setTimeout(run, intervalMs);
    };
    const overdue = Date.now() - lastRun.current >= intervalMs;
    timer = setTimeout(run, overdue ? 0 : intervalMs - (Date.now() - lastRun.current));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, active, intervalMs]);
}
