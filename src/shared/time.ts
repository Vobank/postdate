// Wall-clock arithmetic for schedules.
//
// A schedule is stored as the local date and time the person typed plus an IANA
// time zone, never as a fixed UTC offset. "Every day at 09:00 in Kyiv" has to
// stay at 09:00 when the clocks change, so each occurrence is derived from the
// original wall time and converted to an instant on its own.

export const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
export type Repeat = (typeof REPEATS)[number];

export interface Wall {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parses "YYYY-MM-DDTHH:mm". Returns null for anything that is not a real date. */
export function parseLocal(value: string): Wall | null {
  const m = LOCAL_RE.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 2000 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function formatLocal(w: Wall): string {
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `timeZone` at the instant `utcMs`. */
export function utcToWall(utcMs: number, timeZone: string): Wall {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
  };
}

const wallAsUtc = (w: Wall) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);

function offsetAt(utcMs: number, timeZone: string): number {
  const whole = Math.floor(utcMs / 60_000) * 60_000;
  return wallAsUtc(utcToWall(whole, timeZone)) - whole;
}

/**
 * The instant at which clocks in `timeZone` read `w`.
 *
 * A time skipped by a spring-forward jump lands just after the gap. A time that
 * happens twice in autumn resolves to the first of the two.
 */
export function wallToUtc(w: Wall, timeZone: string): number {
  const naive = wallAsUtc(w);
  const first = naive - offsetAt(naive, timeZone);
  const second = naive - offsetAt(first, timeZone);
  if (first === second) return first;
  // The two guesses straddle a transition. Whichever round-trips is the real one;
  // if neither does, the wall time does not exist and the later instant is used.
  if (wallAsUtc(utcToWall(first, timeZone)) === naive) return first;
  if (wallAsUtc(utcToWall(second, timeZone)) === naive) return second;
  return Math.max(first, second);
}

/** The finer points of a repeating schedule. Every part is optional. */
export interface Rule {
  /** Every N days, weeks, months or years. Defaults to 1. */
  interval?: number;
  /**
   * Weekly schedules only: the days of the week to run on, as a bitmask with
   * bit 0 for Sunday. Zero means "the anchor's own day".
   */
  weekdays?: number;
  /** The last local date, "YYYY-MM-DD", on which the schedule may run. */
  until?: string | null;
}

export const MAX_INTERVAL = 365;

export const weekdayOf = (w: Wall): number => new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();

/**
 * How many days after the anchor each run of one week falls, in order. A week
 * here is the seven days that start on the anchor's own day.
 */
export function weekdayOffsets(anchor: Wall, weekdays: number): number[] {
  const first = weekdayOf(anchor);
  const offsets: number[] = [];
  for (let offset = 0; offset < 7; offset++) {
    if (weekdays & (1 << ((first + offset) % 7))) offsets.push(offset);
  }
  return offsets.length > 0 ? offsets : [0];
}

function shiftDays(anchor: Wall, days: number): Wall {
  const d = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + days));
  return { ...anchor, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The wall time of the n-th occurrence (0 is the first one). */
export function addRepeat(anchor: Wall, repeat: Repeat, n: number, rule: Rule = {}): Wall {
  if (repeat === 'none') return { ...anchor };
  const interval = Math.max(1, Math.floor(rule.interval ?? 1));
  if (repeat === 'daily') return shiftDays(anchor, n * interval);
  if (repeat === 'weekly') {
    const offsets = weekdayOffsets(anchor, rule.weekdays ?? 0);
    const week = Math.floor(n / offsets.length);
    return shiftDays(anchor, week * 7 * interval + (offsets[n % offsets.length] ?? 0));
  }
  // Monthly and yearly keep the anchor's day where the month has one, so a
  // schedule started on the 31st runs on the 30th in April and the 31st in May.
  const months = (anchor.month - 1) + (repeat === 'monthly' ? n : n * 12) * interval;
  const year = anchor.year + Math.floor(months / 12);
  const month = (((months % 12) + 12) % 12) + 1;
  return { ...anchor, year, month, day: Math.min(anchor.day, daysInMonth(year, month)) };
}

export function occurrenceUtc(
  anchor: Wall,
  timeZone: string,
  repeat: Repeat,
  n: number,
  rule: Rule = {},
): number {
  return wallToUtc(addRepeat(anchor, repeat, n, rule), timeZone);
}

const MAX_STEPS = 20_000;

const pastEnd = (w: Wall, until: string | null | undefined): boolean =>
  !!until && formatLocal(w).slice(0, 10) > until;

/**
 * The first occurrence strictly after `afterMs`, starting the search at
 * `fromIndex`. Returns null for one-off schedules, for schedules that have run
 * past their end date, and for ones that would need an unreasonable number of
 * steps to catch up.
 */
export function nextOccurrence(
  anchor: Wall,
  timeZone: string,
  repeat: Repeat,
  afterMs: number,
  fromIndex = 0,
  rule: Rule = {},
): { index: number; at: number } | null {
  if (repeat === 'none') return null;
  for (let i = 0, index = Math.max(0, fromIndex); i < MAX_STEPS; i++, index++) {
    const wall = addRepeat(anchor, repeat, index, rule);
    if (pastEnd(wall, rule.until)) return null;
    const at = wallToUtc(wall, timeZone);
    if (at > afterMs) return { index, at };
  }
  return null;
}

/**
 * Every run that falls inside [fromMs, toMs), at most `limit` of them. Used to
 * preview a schedule and to draw the calendar.
 */
export function occurrencesBetween(
  anchor: Wall,
  timeZone: string,
  repeat: Repeat,
  rule: Rule,
  fromIndex: number,
  fromMs: number,
  toMs: number,
  limit = 100,
): number[] {
  const out: number[] = [];
  if (repeat === 'none') {
    const at = wallToUtc(anchor, timeZone);
    return at >= fromMs && at < toMs ? [at] : out;
  }
  let cursor = nextOccurrence(anchor, timeZone, repeat, fromMs - 1, fromIndex, rule);
  while (cursor && cursor.at < toMs && out.length < limit) {
    out.push(cursor.at);
    cursor = nextOccurrence(anchor, timeZone, repeat, cursor.at, cursor.index + 1, rule);
  }
  return out;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written "YYYY-MM-DD". */
export function isLocalDate(value: string): boolean {
  return DATE_RE.test(value) && parseLocal(`${value}T00:00`) !== null;
}
