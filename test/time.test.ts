import { describe, expect, it } from 'vitest';
import {
  addRepeat,
  formatLocal,
  isLocalDate,
  isValidTimeZone,
  nextOccurrence,
  occurrencesBetween,
  parseLocal,
  utcToWall,
  wallToUtc,
} from '../src/shared/time';

const wall = (s: string) => {
  const w = parseLocal(s);
  if (!w) throw new Error(`bad fixture ${s}`);
  return w;
};
const iso = (ms: number) => new Date(ms).toISOString();

describe('parseLocal', () => {
  it('accepts a well-formed local time', () => {
    expect(parseLocal('2027-03-09T08:05')).toEqual({ year: 2027, month: 3, day: 9, hour: 8, minute: 5 });
  });

  it.each(['', '2027-3-9T08:05', '2027-02-30T10:00', '2027-13-01T10:00', '2027-01-01T24:00', '2027-01-01 10:00'])(
    'rejects %j',
    (value) => {
      expect(parseLocal(value)).toBeNull();
    },
  );

  it('round-trips through formatLocal', () => {
    expect(formatLocal(wall('2028-02-29T23:59'))).toBe('2028-02-29T23:59');
  });
});

describe('wallToUtc', () => {
  it('handles a zone without daylight saving', () => {
    expect(iso(wallToUtc(wall('2027-06-01T09:00'), 'Asia/Tokyo'))).toBe('2027-06-01T00:00:00.000Z');
  });

  it('uses the offset in force on that date', () => {
    expect(iso(wallToUtc(wall('2027-01-15T09:00'), 'Europe/Kyiv'))).toBe('2027-01-15T07:00:00.000Z');
    expect(iso(wallToUtc(wall('2027-07-15T09:00'), 'Europe/Kyiv'))).toBe('2027-07-15T06:00:00.000Z');
  });

  it('handles half-hour offsets', () => {
    expect(iso(wallToUtc(wall('2027-05-01T12:00'), 'Asia/Kolkata'))).toBe('2027-05-01T06:30:00.000Z');
  });

  it('moves a time skipped by spring-forward to after the gap', () => {
    // 02:30 does not exist in New York on 14 March 2027.
    const at = wallToUtc(wall('2027-03-14T02:30'), 'America/New_York');
    expect(iso(at)).toBe('2027-03-14T07:30:00.000Z');
    expect(formatLocal(utcToWall(at, 'America/New_York'))).toBe('2027-03-14T03:30');
  });

  it('picks the first of two identical autumn times', () => {
    // 01:30 happens twice in New York on 7 November 2027.
    expect(iso(wallToUtc(wall('2027-11-07T01:30'), 'America/New_York'))).toBe('2027-11-07T05:30:00.000Z');
  });

  it('is the inverse of utcToWall', () => {
    const at = Date.UTC(2027, 9, 3, 14, 20);
    for (const tz of ['UTC', 'Europe/Berlin', 'America/Sao_Paulo', 'Australia/Lord_Howe', 'Asia/Kathmandu']) {
      expect(wallToUtc(utcToWall(at, tz), tz)).toBe(at);
    }
  });
});

describe('addRepeat', () => {
  it('steps days and weeks across month ends', () => {
    expect(formatLocal(addRepeat(wall('2027-01-30T08:00'), 'daily', 3))).toBe('2027-02-02T08:00');
    expect(formatLocal(addRepeat(wall('2027-12-27T08:00'), 'weekly', 1))).toBe('2028-01-03T08:00');
  });

  it('clamps monthly repeats to the last day, then returns to the anchor day', () => {
    const anchor = wall('2027-01-31T08:00');
    expect(formatLocal(addRepeat(anchor, 'monthly', 1))).toBe('2027-02-28T08:00');
    expect(formatLocal(addRepeat(anchor, 'monthly', 2))).toBe('2027-03-31T08:00');
    expect(formatLocal(addRepeat(anchor, 'monthly', 12))).toBe('2028-01-31T08:00');
  });

  it('handles 29 February in yearly repeats', () => {
    const anchor = wall('2028-02-29T08:00');
    expect(formatLocal(addRepeat(anchor, 'yearly', 1))).toBe('2029-02-28T08:00');
    expect(formatLocal(addRepeat(anchor, 'yearly', 4))).toBe('2032-02-29T08:00');
  });
});

describe('addRepeat with a rule', () => {
  const dates = (anchor: string, count: number, rule: { interval?: number; weekdays?: number }) =>
    Array.from({ length: count }, (_, n) => formatLocal(addRepeat(wall(anchor), 'weekly', n, rule)).slice(0, 10));

  it('steps by the interval', () => {
    expect(formatLocal(addRepeat(wall('2027-01-30T08:00'), 'daily', 2, { interval: 3 }))).toBe('2027-02-05T08:00');
    expect(formatLocal(addRepeat(wall('2027-01-04T08:00'), 'weekly', 3, { interval: 2 }))).toBe('2027-02-15T08:00');
    expect(formatLocal(addRepeat(wall('2027-11-30T08:00'), 'monthly', 1, { interval: 3 }))).toBe('2028-02-29T08:00');
    expect(formatLocal(addRepeat(wall('2028-02-29T08:00'), 'yearly', 1, { interval: 4 }))).toBe('2032-02-29T08:00');
  });

  it('walks the chosen days of the week in order', () => {
    // 4 January 2027 is a Monday. Monday, Wednesday and Friday.
    const days = (1 << 1) | (1 << 3) | (1 << 5);
    expect(dates('2027-01-04T08:00', 5, { weekdays: days })).toEqual([
      '2027-01-04',
      '2027-01-06',
      '2027-01-08',
      '2027-01-11',
      '2027-01-13',
    ]);
  });

  it('starts on the first chosen day when the anchor is not one of them', () => {
    // Anchored on a Wednesday, running on Mondays and Tuesdays.
    const days = (1 << 1) | (1 << 2);
    expect(dates('2027-01-06T08:00', 3, { weekdays: days })).toEqual(['2027-01-11', '2027-01-12', '2027-01-18']);
  });

  it('skips whole weeks between runs of chosen days', () => {
    const days = (1 << 1) | (1 << 5);
    expect(dates('2027-01-04T08:00', 4, { weekdays: days, interval: 2 })).toEqual([
      '2027-01-04',
      '2027-01-08',
      '2027-01-18',
      '2027-01-22',
    ]);
  });
});

describe('schedules that end', () => {
  const anchor = wall('2027-01-01T09:00');

  it('runs on the last day and not after it', () => {
    const rule = { until: '2027-01-03' };
    expect(nextOccurrence(anchor, 'UTC', 'daily', Date.UTC(2027, 0, 2, 9), 0, rule)?.at).toBe(Date.UTC(2027, 0, 3, 9));
    expect(nextOccurrence(anchor, 'UTC', 'daily', Date.UTC(2027, 0, 3, 9), 0, rule)).toBeNull();
  });

  it('reads the last day in the time zone of the schedule', () => {
    // 23:30 on the 2nd in Tokyo is 14:30 UTC, still inside the last day there.
    const late = wall('2027-01-01T23:30');
    const next = nextOccurrence(late, 'Asia/Tokyo', 'daily', wallToUtc(late, 'Asia/Tokyo'), 0, { until: '2027-01-02' });
    expect(formatLocal(utcToWall(next?.at ?? 0, 'Asia/Tokyo'))).toBe('2027-01-02T23:30');
  });
});

describe('occurrencesBetween', () => {
  const anchor = wall('2027-01-01T09:00');

  it('lists the runs inside a window', () => {
    const runs = occurrencesBetween(anchor, 'UTC', 'daily', {}, 0, Date.UTC(2027, 0, 3), Date.UTC(2027, 0, 6));
    expect(runs.map(iso)).toEqual([
      '2027-01-03T09:00:00.000Z',
      '2027-01-04T09:00:00.000Z',
      '2027-01-05T09:00:00.000Z',
    ]);
  });

  it('includes a run at the very start of the window and stops at the limit', () => {
    const runs = occurrencesBetween(anchor, 'UTC', 'weekly', {}, 0, Date.UTC(2027, 0, 1, 9), Infinity, 2);
    expect(runs).toEqual([Date.UTC(2027, 0, 1, 9), Date.UTC(2027, 0, 8, 9)]);
  });

  it('stops at the end date', () => {
    expect(occurrencesBetween(anchor, 'UTC', 'daily', { until: '2027-01-02' }, 0, 0, Infinity)).toHaveLength(2);
  });

  it('gives a one-off message its single run', () => {
    expect(occurrencesBetween(anchor, 'UTC', 'none', {}, 0, 0, Infinity)).toEqual([Date.UTC(2027, 0, 1, 9)]);
    expect(occurrencesBetween(anchor, 'UTC', 'none', {}, 0, Date.UTC(2027, 0, 2), Infinity)).toEqual([]);
  });
});

describe('isLocalDate', () => {
  it('accepts real dates only', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2027-02-29')).toBe(false);
    expect(isLocalDate('2027-2-9')).toBe(false);
    expect(isLocalDate('')).toBe(false);
  });
});

describe('nextOccurrence', () => {
  it('returns null for one-off schedules', () => {
    expect(nextOccurrence(wall('2027-01-01T09:00'), 'UTC', 'none', 0)).toBeNull();
  });

  it('keeps the local hour across a daylight-saving change', () => {
    const anchor = wall('2027-03-27T09:00'); // Kyiv switches to summer time on the 28th
    const first = wallToUtc(anchor, 'Europe/Kyiv');
    const next = nextOccurrence(anchor, 'Europe/Kyiv', 'daily', first, 0);
    expect(next?.index).toBe(1);
    expect(iso(next?.at ?? 0)).toBe('2027-03-28T06:00:00.000Z');
    expect(formatLocal(utcToWall(next?.at ?? 0, 'Europe/Kyiv'))).toBe('2027-03-28T09:00');
  });

  it('skips occurrences that were missed', () => {
    const anchor = wall('2027-01-01T09:00');
    const after = Date.UTC(2027, 0, 10, 12);
    const next = nextOccurrence(anchor, 'UTC', 'daily', after, 0);
    expect(next).toEqual({ index: 10, at: Date.UTC(2027, 0, 11, 9) });
  });

  it('is strictly after the reference instant', () => {
    const anchor = wall('2027-01-01T09:00');
    const exact = Date.UTC(2027, 0, 8, 9);
    expect(nextOccurrence(anchor, 'UTC', 'weekly', exact, 0)?.at).toBe(Date.UTC(2027, 0, 15, 9));
  });
});

describe('isValidTimeZone', () => {
  it('knows real zones from made-up ones', () => {
    expect(isValidTimeZone('Europe/Kyiv')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
