// Dates and times are formatted by the browser's Intl, so they follow the
// chosen language without any translated strings of our own.

const DAY_MS = 86_400_000;

export const browserTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function timeZones(): string[] {
  const zones = new Set<string>(
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [],
  );
  zones.add('UTC');
  zones.add(browserTimeZone());
  return [...zones].sort();
}

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Groups instants by calendar day in the browser's own time zone. */
export const dayKey = (ms: number): number => startOfDay(ms);

/** "Today", "Tomorrow", or a full date. */
export function dayLabel(ms: number, lang: string): string {
  const days = Math.round((startOfDay(ms) - startOfDay(Date.now())) / DAY_MS);
  if (Math.abs(days) <= 1) {
    return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(days, 'day');
  }
  const sameYear = new Date(ms).getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  }).format(ms);
}

export function timeLabel(ms: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(ms);
}

export function dateTimeLabel(ms: number, lang: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(lang, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(ms);
}

export function shortDateTime(ms: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

/** "in 3 hours", "2 days ago". */
export function relativeLabel(ms: number, lang: string): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (abs < 3_600_000) return format.format(Math.round(diff / 60_000), 'minute');
  if (abs < 2 * DAY_MS) return format.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 60 * DAY_MS) return format.format(Math.round(diff / DAY_MS), 'day');
  if (abs < 730 * DAY_MS) return format.format(Math.round(diff / (30.44 * DAY_MS)), 'month');
  return format.format(Math.round(diff / (365.25 * DAY_MS)), 'year');
}
