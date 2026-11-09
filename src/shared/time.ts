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

/** The wall time of the n-th occurrence (0 is the anchor itself). */
export function addRepeat(anchor: Wall, repeat: Repeat, n: number): Wall {
  if (repeat === 'none' || n === 0) return { ...anchor };
  if (repeat === 'daily' || repeat === 'weekly') {
    const step = repeat === 'daily' ? 1 : 7;
    const d = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + n * step));
    return {
      ...anchor,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  }
  // Monthly and yearly keep the anchor's day where the month has one, so a
  // schedule started on the 31st runs on the 30th in April and the 31st in May.
  const months = (anchor.month - 1) + (repeat === 'monthly' ? n : n * 12);
  const year = anchor.year + Math.floor(months / 12);
  const month = (((months % 12) + 12) % 12) + 1;
  return { ...anchor, year, month, day: Math.min(anchor.day, daysInMonth(year, month)) };
}

export function occurrenceUtc(anchor: Wall, timeZone: string, repeat: Repeat, n: number): number {
  return wallToUtc(addRepeat(anchor, repeat, n), timeZone);
}

const MAX_STEPS = 20_000;

/**
 * The first occurrence strictly after `afterMs`, starting the search at
 * `fromIndex`. Returns null for one-off schedules and for schedules that would
 * need an unreasonable number of steps to catch up.
 */
export function nextOccurrence(
  anchor: Wall,
  timeZone: string,
  repeat: Repeat,
  afterMs: number,
  fromIndex = 0,
): { index: number; at: number } | null {
  if (repeat === 'none') return null;
  for (let i = 0, index = Math.max(0, fromIndex); i < MAX_STEPS; i++, index++) {
    const at = occurrenceUtc(anchor, timeZone, repeat, index);
    if (at > afterMs) return { index, at };
  }
  return null;
}
