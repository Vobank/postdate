// Types for messages.mjs, which stays plain JavaScript so Node can run it as it is.
export const LANGUAGES: [code: string, name: string][];
export const MESSAGES: Record<string, Record<string, string>>;
export function messages(lang: string): (key: string, vars?: Record<string, string | number>) => string;
