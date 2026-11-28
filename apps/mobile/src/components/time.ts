/** "now", "5 min", "3 h", "2 d", or a date for older times; empty for none. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** How long between two times: "4 min", "1 h 5 min". */
export function duration(fromIso: string | null | undefined, toIso: string | null | undefined): string {
  const from = fromIso ? Date.parse(fromIso) : Number.NaN;
  const to = toIso ? Date.parse(toIso) : Number.NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return '';
  const minutes = Math.round((to - from) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A clock time today, else a short date and time, in the device's time zone. */
export function clockTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A URL without its scheme and host when it's on the store's own site: "/t/bags?page=2". */
export function shortUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}
