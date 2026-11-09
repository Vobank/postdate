import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { ApiError } from './api';
import en from './locales/en.json';

type Dictionary = Record<string, string>;

/** Shown in the language picker, each in its own language. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'pt-BR', name: 'Português' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'uk', name: 'Українська' },
  { code: 'ru', name: 'Русский' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

const RTL: ReadonlySet<string> = new Set(['ar']);
const STORAGE_KEY = 'postdate.lang';

const loaders = import.meta.glob<{ default: Dictionary }>(['./locales/*.json', '!./locales/en.json']);
const loaded = new Map<string, Dictionary>([['en', en]]);

const isLang = (code: string): code is Lang => LANGUAGES.some((l) => l.code === code);

/** The saved choice, or the closest match to the browser's languages. */
export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isLang(saved)) return saved;
  } catch {
    // Storage can be unavailable in private windows.
  }
  for (const wanted of navigator.languages ?? [navigator.language]) {
    if (isLang(wanted)) return wanted;
    const base = wanted.split('-')[0];
    const match = LANGUAGES.find((l) => l.code.split('-')[0] === base);
    if (match) return match.code;
  }
  return 'en';
}

export async function loadLang(lang: Lang): Promise<void> {
  if (!loaded.has(lang)) {
    const load = loaders[`./locales/${lang}.json`];
    if (load) loaded.set(lang, (await load()).default);
  }
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not being able to remember the choice is fine.
  }
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function translator(lang: Lang): Translate {
  const dictionary: Dictionary = loaded.get(lang) ?? en;
  return (key, vars) => {
    const template = dictionary[key] ?? (en as Dictionary)[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (whole: string, name: string) =>
      name in vars ? String(vars[name]) : whole,
    );
  };
}

export interface I18n {
  lang: Lang;
  t: Translate;
  setLang: (lang: Lang) => void;
}

export const I18nContext = createContext<I18n>({ lang: 'en', t: translator('en'), setLang: () => {} });
export const useI18n = () => useContext(I18nContext);

// Server validation names a field; these are the labels for the ones that are
// not channel settings (those use "field.<key>").
const FIELD_LABELS: Record<string, string> = {
  to: 'msg.to',
  subject: 'msg.subject',
  body: 'msg.body',
  time: 'msg.time',
  timezone: 'msg.timezone',
  repeat: 'msg.repeat',
  channel: 'msg.channel',
  name: 'channel.name',
};

const GENERIC_FIELD_ERRORS = new Set(['invalid_number', 'invalid_option', 'invalid_text', 'bad_request']);

/** A sentence for any error thrown by the API client. */
export function errorText(t: Translate, error: unknown): string {
  if (!(error instanceof ApiError)) return t('err.unknown');
  const field = error.field ? t(FIELD_LABELS[error.field] ?? `field.${error.field}`) : '';
  const code = GENERIC_FIELD_ERRORS.has(error.code) && field ? 'invalid_field' : error.code;
  const key = `err.${code}`;
  const text = t(key, { field, detail: error.detail ?? '' });
  return text === key ? t('err.unknown') : text;
}
