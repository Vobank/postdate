// Dates, times, durations and day names are formatted by the browser's Intl, so
// they follow the chosen language without any translated strings of our own.

import type { Repeat } from '../shared/time';
import { hour12 } from './prefs';

export const DAY_MS = 86_400_000;

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

export const startOfDay = (ms: number): number => {
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
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hour12: hour12() }).format(ms);
}

export function dateTimeLabel(ms: number, lang: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(lang, {
    dateStyle: 'full',
    timeStyle: 'short',
    hour12: hour12(),
    timeZone,
  }).format(ms);
}

export function shortDateTime(ms: number, lang: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(lang, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: hour12(),
    timeZone,
  }).format(ms);
}

/** "Tue, 9 Mar, 08:05": compact, for lists of upcoming sends. */
export function compactDateTime(ms: number, lang: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(lang, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: hour12(),
    timeZone,
  }).format(ms);
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

type Unit = 'day' | 'hour' | 'minute' | 'second' | 'week' | 'month' | 'year';

const amount = (n: number, unit: Unit, lang: string, display: 'narrow' | 'long'): string =>
  new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: display }).format(n);

/** A ticking "2d 4h", "3h 12m" or "4m 09s" for the time left until `ms`. */
export function countdown(ms: number, lang: string, now = Date.now()): string {
  const left = Math.max(0, Math.floor((ms - now) / 1000));
  const days = Math.floor(left / 86_400);
  const hours = Math.floor((left % 86_400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const narrow = (n: number, unit: Unit) => amount(n, unit, lang, 'narrow');
  if (days > 0) return `${narrow(days, 'day')} ${narrow(hours, 'hour')}`;
  if (hours > 0) return `${narrow(hours, 'hour')} ${narrow(minutes, 'minute')}`;
  return `${narrow(minutes, 'minute')} ${narrow(left % 60, 'second')}`;
}

const REPEAT_UNITS: Record<Exclude<Repeat, 'none'>, Unit> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

/** The length of one step of a repeat: "3 days", "2 weeks". */
export function periodLabel(repeat: Repeat, interval: number, lang: string): string {
  return repeat === 'none' ? '' : amount(interval, REPEAT_UNITS[repeat], lang, 'long');
}

/** Names of the days of the week, index 0 being Sunday. */
export function weekdayNames(lang: string, width: 'short' | 'narrow' = 'short'): string[] {
  const format = new Intl.DateTimeFormat(lang, { weekday: width, timeZone: 'UTC' });
  // 1 January 2023 was a Sunday.
  return Array.from({ length: 7 }, (_, day) => format.format(Date.UTC(2023, 0, 1 + day)));
}

interface WeekInfo {
  firstDay?: number;
}

/** The day a week starts on where `lang` is spoken: 0 for Sunday, 1 for Monday. */
export function firstWeekday(lang: string): number {
  try {
    const locale = new Intl.Locale(lang) as Intl.Locale & {
      getWeekInfo?: () => WeekInfo;
      weekInfo?: WeekInfo;
    };
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    if (typeof first === 'number') return first % 7;
  } catch {
    // Older browsers: fall through to Monday.
  }
  return 1;
}

/** Weekday indexes in the order a calendar in `lang` lists them. */
export function weekOrder(lang: string): number[] {
  const first = firstWeekday(lang);
  return Array.from({ length: 7 }, (_, i) => (first + i) % 7);
}

export function monthLabel(year: number, month: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}

export function relativeMonth(offset: number, lang: string): string {
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(offset, 'month');
}

export function todayLabel(lang: string): string {
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(0, 'day');
}
