import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { LANGUAGES, errorText, useI18n } from './i18n';
import type { Lang } from './i18n';

export function Notice({ kind, children }: { kind: 'error' | 'ok'; children: ComponentChildren }) {
  return (
    <p class={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useI18n();
  return error ? <Notice kind="error">{errorText(t, error)}</Notice> : null;
}

interface FieldProps {
  label: string;
  hint?: string;
  optional?: boolean;
  children: ComponentChildren;
}

export function Field({ label, hint, optional, children }: FieldProps) {
  const { t } = useI18n();
  return (
    <label class="field">
      <span class="field-label">
        {label}
        {optional && <span class="field-optional"> ({t('common.optional')})</span>}
      </span>
      {children}
      {hint && <span class="field-hint">{hint}</span>}
    </label>
  );
}

interface ConfirmProps {
  label: string;
  question: string;
  onConfirm: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** A button that asks once, in place, before doing something that cannot be undone. */
export function ConfirmButton({ label, question, onConfirm, danger, disabled }: ConfirmProps) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" class={danger ? 'btn-text danger' : 'btn-text'} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span class="confirm">
      <span>{question}</span>
      <button
        type="button"
        class={danger ? 'btn-text danger' : 'btn-text'}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {t('common.yes')}
      </button>
      <button type="button" class="btn-text" onClick={() => setAsking(false)}>
        {t('common.cancel')}
      </button>
    </span>
  );
}

export function LanguageSelect({ id }: { id?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <select
      id={id}
      aria-label={t('settings.language')}
      value={lang}
      onChange={(event) => setLang((event.currentTarget as HTMLSelectElement).value as Lang)}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}

export const inputValue = (event: Event): string =>
  (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
