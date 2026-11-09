/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import en from '../src/client/locales/en.json';

type Dictionary = Record<string, string>;

const files = import.meta.glob<Dictionary>('../src/client/locales/*.json', {
  eager: true,
  import: 'default',
});
const others = Object.entries(files)
  .map(([path, dictionary]): [string, Dictionary] => [path.split('/').pop() ?? path, dictionary])
  .filter(([name]) => name !== 'en.json');

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('translations', () => {
  it('cover the twelve other languages', () => {
    expect(others.length).toBe(12);
  });

  for (const [name, locale] of others) {
    it(`${name} has the same keys as English`, () => {
      expect(Object.keys(locale).sort()).toEqual(Object.keys(en).sort());
    });

    it(`${name} keeps every placeholder and has no empty strings`, () => {
      for (const [key, text] of Object.entries(en as Dictionary)) {
        expect(placeholders(locale[key] ?? ''), key).toEqual(placeholders(text));
        expect((locale[key] ?? '').trim(), key).not.toBe('');
      }
    });
  }
});
