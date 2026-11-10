import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { LANGUAGES, errorText, useI18n } from './i18n';
import type { Lang } from './i18n';
import { InfoIcon } from './icons';

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

interface InfoProps {
  /** Words shown next to the "i". Without them the button is the icon alone. */
  text?: string;
  /** Name of the button for screen readers when there are no words. */
  label?: string;
  children: ComponentChildren;
}

/**
 * An "i" that opens an explanation right under it. Put it inside a wrapping
 * flex row: the explanation takes the full width of the next line.
 */
export function Info({ text, label, children }: InfoProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const name = label ?? t('help.show');
  return (
    <>
      <button
        type="button"
        class={text ? 'info-btn info-btn-wide' : 'info-btn'}
        aria-expanded={open}
        aria-label={text ? undefined : name}
        title={text ? undefined : name}
        onClick={(event) => {
          // Inside a <label> a click would otherwise also land on the field.
          event.preventDefault();
          setOpen(!open);
        }}
      >
        <InfoIcon />
        {text && <span>{text}</span>}
      </button>
      {open && (
        <div class="info-panel" role="note">
          {children}
        </div>
      )}
    </>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  /** A longer explanation, opened with the "i" next to the label. */
  help?: string;
  optional?: boolean;
  children: ComponentChildren;
}

export function Field({ label, hint, help, optional, children }: FieldProps) {
  const { t } = useI18n();
  return (
    <label class="field">
      <span class="field-label">
        <span>
          {label}
          {optional && <span class="field-optional"> ({t('common.optional')})</span>}
        </span>
        {help && <Info label={`${t('help.show')}: ${label}`}>{help}</Info>}
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

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** A short row of mutually exclusive choices. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
