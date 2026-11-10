// Variables a message may contain. They are filled in at the moment of sending,
// so a repeating message can say something different every time.
//
//   {{date}}             2027-03-09, in the message's own time zone
//   {{time}}             08:05
//   {{count}}            1 for the first send, 2 for the second, ...
//   {{days:2027-12-31}}  whole days left until that date (negative once it has passed)
//
// Anything else in double braces is left exactly as written.

import { formatLocal, isLocalDate, utcToWall } from './time';

export const VARIABLES = ['{{date}}', '{{time}}', '{{count}}', '{{days:2027-01-01}}'] as const;

export interface TemplateContext {
  now: number;
  timeZone: string;
  /** Which send this is, counting from 1. */
  count: number;
}

const TOKEN_RE = /\{\{\s*(date|time|count|days)\s*(?::\s*(\d{4}-\d{2}-\d{2})\s*)?\}\}/g;

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export function renderTemplate(text: string, context: TemplateContext): string {
  if (!text.includes('{{')) return text;
  const [date = '', time = ''] = formatLocal(utcToWall(context.now, context.timeZone)).split('T');
  return text.replace(TOKEN_RE, (whole: string, name: string, argument?: string) => {
    if (name === 'days') {
      if (!argument || !isLocalDate(argument)) return whole;
      return String(Math.round(dayNumber(argument) - dayNumber(date)));
    }
    if (argument) return whole;
    if (name === 'date') return date;
    if (name === 'time') return time;
    return String(context.count);
  });
}
