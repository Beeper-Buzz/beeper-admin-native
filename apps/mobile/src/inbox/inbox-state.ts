import type { Conversation, Message } from '@instincts/spree-domain';

/**
 * Pure helpers for the inbox screens: list filters, merging polled conversations and messages, and
 * the snooze choices.
 */

export type InboxFilter = 'open' | 'mine' | 'unassigned' | 'closed';

export const INBOX_FILTERS: readonly (readonly [InboxFilter, string])[] = [
  ['open', 'Open'],
  ['mine', 'Mine'],
  ['unassigned', 'Unassigned'],
  ['closed', 'Closed'],
];

/** The list query for a filter tab. */
export function filterParams(filter: InboxFilter): {
  status: 'open' | 'closed';
  assignee: 'me' | 'unassigned' | 'any';
} {
  switch (filter) {
    case 'mine':
      return { status: 'open', assignee: 'me' };
    case 'unassigned':
      return { status: 'open', assignee: 'unassigned' };
    case 'closed':
      return { status: 'closed', assignee: 'any' };
    default:
      return { status: 'open', assignee: 'any' };
  }
}

/**
 * Whether a conversation that changed still belongs in a filter tab, as far as the app can tell
 * (it doesn't know which staff member it is, so Mine keeps any assigned conversation).
 */
export function stillMatches(c: Conversation, filter: InboxFilter): boolean {
  const { status, assignee } = filterParams(filter);
  if (c.status !== status) return false;
  if (assignee === 'unassigned') return c.assignee === null;
  if (assignee === 'me') return c.assignee !== null;
  return true;
}

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Polled changes folded into the loaded pages: changed conversations leave their old place, and
 * those that still match go to the top, newest activity first.
 */
export function mergeConversations(
  pages: readonly { items: Conversation[] }[],
  changed: readonly Conversation[],
  filter: InboxFilter,
): Conversation[][] {
  const ids = new Set(changed.map((c) => c.id));
  const rest = pages.map((p) => p.items.filter((c) => !ids.has(c.id)));
  const top = changed
    .filter((c) => stillMatches(c, filter))
    .sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  if (!rest.length) return [top];
  return [[...top, ...(rest[0] ?? [])], ...rest.slice(1)];
}

/** When to ask for changes from: the newest activity loaded, else a minute before `fallbackMs`. */
export function pollSince(conversations: readonly Conversation[], fallbackMs: number): string {
  const newest = Math.max(0, ...conversations.map((c) => time(c.updatedAt)));
  return new Date(newest || fallbackMs - 60_000).toISOString();
}

/** Messages by id, oldest first; a message seen twice keeps its newest copy. */
export function mergeMessages(existing: readonly Message[], incoming: readonly Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  const order = [...byId.values()];
  const numeric = (id: string) => (/^\d+$/.test(id) ? Number(id) : Number.NaN);
  return order.sort((a, b) => {
    const t = time(a.createdAt) - time(b.createdAt);
    if (t) return t;
    const na = numeric(a.id);
    const nb = numeric(b.id);
    return Number.isNaN(na) || Number.isNaN(nb) ? 0 : na - nb;
  });
}

/** The Inbox tab badge: the unread count ("99+" above 99), or null for none. */
export function unreadBadge(unread: number | null | undefined): string | null {
  if (!unread || unread < 0) return null;
  return unread > 99 ? '99+' : String(unread);
}

export interface SnoozeOption {
  key: '1h' | 'tomorrow' | 'next-week';
  label: string;
  until: Date;
}

/** Morning hour that "tomorrow" and "next week" bring a conversation back at, local time. */
export const SNOOZE_MORNING_HOUR = 9;

/** The snooze choices from `now`: in an hour, tomorrow at 9:00, and next Monday at 9:00. */
export function snoozeOptions(now: Date = new Date()): SnoozeOption[] {
  const morning = (days: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, SNOOZE_MORNING_HOUR, 0, 0, 0);
    return d;
  };
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { key: '1h', label: '1 hour', until: new Date(now.getTime() + 60 * 60 * 1000) },
    { key: 'tomorrow', label: 'Tomorrow', until: morning(1) },
    { key: 'next-week', label: 'Next week', until: morning(toMonday) },
  ];
}
