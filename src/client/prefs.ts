// Choices about how the app looks. They belong to this browser, not to the
// instance, so they live in localStorage and never touch the server.

export const THEMES = ['auto', 'light', 'dark'] as const;
export const ACCENTS = ['red', 'blue', 'green', 'violet'] as const;
export const CLOCKS = ['auto', '12', '24'] as const;

export interface Prefs {
  theme: (typeof THEMES)[number];
  accent: (typeof ACCENTS)[number];
  clock: (typeof CLOCKS)[number];
}

const STORAGE_KEY = 'postdate.prefs';
const DEFAULTS: Prefs = { theme: 'auto', accent: 'red', clock: 'auto' };

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;

function read(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return {
      theme: oneOf(THEMES, saved.theme, DEFAULTS.theme),
      accent: oneOf(ACCENTS, saved.accent, DEFAULTS.accent),
      clock: oneOf(CLOCKS, saved.clock, DEFAULTS.clock),
    };
  } catch {
    // Storage can be unavailable in private windows, or hold something odd.
    return { ...DEFAULTS };
  }
}

let current: Prefs = read();

export const getPrefs = (): Prefs => current;

/** Puts the choices on <html>, where the stylesheet picks them up. */
export function applyPrefs(): void {
  const root = document.documentElement;
  if (current.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = current.theme;
  root.dataset.accent = current.accent;
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Not being able to remember the choice is fine.
  }
  applyPrefs();
  return current;
}

/** What to pass to Intl as `hour12`; undefined leaves it to the language. */
export const hour12 = (): boolean | undefined =>
  current.clock === 'auto' ? undefined : current.clock === '12';
