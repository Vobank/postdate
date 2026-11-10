import { describe, expect, it } from 'vitest';
import { VARIABLES, renderTemplate } from '../src/shared/template';

const context = { now: Date.parse('2027-03-09T22:30:00Z'), timeZone: 'UTC', count: 3 };

describe('renderTemplate', () => {
  it('fills in the date, the time and the send number', () => {
    expect(renderTemplate('Report {{count}} for {{date}} at {{time}}', context)).toBe(
      'Report 3 for 2027-03-09 at 22:30',
    );
  });

  it('reads the clock in the time zone of the message', () => {
    // Half past ten in the evening UTC is already the next morning in Tokyo.
    expect(renderTemplate('{{date}} {{time}}', { ...context, timeZone: 'Asia/Tokyo' })).toBe('2027-03-10 07:30');
  });

  it('counts the days left until a date', () => {
    expect(renderTemplate('{{days:2027-03-19}} days to go', context)).toBe('10 days to go');
    expect(renderTemplate('{{days:2027-03-09}}', context)).toBe('0');
    expect(renderTemplate('{{days:2027-03-08}}', context)).toBe('-1');
    expect(renderTemplate('{{days:2028-03-09}}', context)).toBe('366');
  });

  it('allows spaces inside the braces', () => {
    expect(renderTemplate('{{ date }} / {{ days : 2027-03-10 }}', context)).toBe('2027-03-09 / 1');
  });

  it('leaves everything it does not recognise alone', () => {
    const text = '{{name}} {date} {{days}} {{days:2027-02-30}} {{date:2027-01-01}} {"a":{"b":1}}';
    expect(renderTemplate(text, context)).toBe(text);
  });

  it('understands every variable the composer offers', () => {
    for (const token of VARIABLES) expect(renderTemplate(token, context)).not.toBe(token);
  });
});
