import { describe, expect, it } from 'vitest';
import { LANGUAGES, MESSAGES } from '../scripts/messages.mjs';

const all = MESSAGES;
const en = all.en ?? {};
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('installer messages', () => {
  for (const [code] of LANGUAGES) {
    if (code === 'en') continue;
    it(`${code} matches English`, () => {
      const own = all[code] ?? {};
      expect(Object.keys(own).sort()).toEqual(Object.keys(en).sort());
      for (const [key, text] of Object.entries(en)) {
        expect(placeholders(own[key] ?? ''), key).toEqual(placeholders(text));
        expect((own[key] ?? '').trim(), key).not.toBe('');
      }
    });
  }
});
