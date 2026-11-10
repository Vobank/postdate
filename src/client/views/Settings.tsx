import { useState } from 'preact/hooks';
import { api } from '../api';
import { useI18n } from '../i18n';
import { ACCENTS, CLOCKS, THEMES, getPrefs, setPrefs } from '../prefs';
import type { Prefs } from '../prefs';
import { ErrorNotice, Field, LanguageSelect, Notice, Segmented, inputValue } from '../ui';

/** Hands a JSON document to the browser as a file to save. */
function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Settings({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const { t } = useI18n();
  const [prefs, setPrefsState] = useState<Prefs>(getPrefs);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leavePassword, setLeavePassword] = useState('');
  const [leaveError, setLeaveError] = useState<unknown>(null);

  const deleteAccount = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setLeaveError(null);
    try {
      await api('POST', '/account/delete', { password: leavePassword });
      onSignedOut();
    } catch (e) {
      setLeaveError(e);
      setBusy(false);
    }
  };

  const choose = (patch: Partial<Prefs>) => setPrefsState(setPrefs(patch));

  const changePassword = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNote('');
    try {
      await api('POST', '/password', { current, next });
      setCurrent('');
      setNext('');
      setNote(t('settings.changed'));
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };

  const exportData = async () => {
    setBusy(true);
    setExportError(null);
    try {
      const data = await api<Record<string, unknown>>('GET', '/export');
      download(`postdate-${new Date().toISOString().slice(0, 10)}.json`, data);
    } catch (e) {
      setExportError(e);
    }
    setBusy(false);
  };

  const signOut = async () => {
    try {
      await api('POST', '/logout');
    } finally {
      onSignedOut();
    }
  };

  return (
    <>
      <h1>{t('nav.settings')}</h1>

      <div class="form">
        <h2 class="day-title">{t('settings.appearance')}</h2>
        <div class="field">
          <span class="field-label">{t('settings.theme')}</span>
          <Segmented
            label={t('settings.theme')}
            value={prefs.theme}
            onChange={(theme) => choose({ theme })}
            options={THEMES.map((value) => ({ value, label: t(`theme.${value}`) }))}
          />
        </div>
        <div class="field">
          <span class="field-label">{t('settings.accent')}</span>
          <div class="swatches" role="group" aria-label={t('settings.accent')}>
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                class="swatch"
                data-accent={accent}
                aria-pressed={prefs.accent === accent}
                aria-label={t(`accent.${accent}`)}
                title={t(`accent.${accent}`)}
                onClick={() => choose({ accent })}
              />
            ))}
          </div>
        </div>
        <div class="field">
          <span class="field-label">{t('settings.clock')}</span>
          <Segmented
            label={t('settings.clock')}
            value={prefs.clock}
            onChange={(clock) => choose({ clock })}
            options={CLOCKS.map((value) => ({
              value,
              label: value === 'auto' ? t('theme.auto') : t(`clock.${value}`),
            }))}
          />
        </div>
        <Field label={t('settings.language')}>
          <LanguageSelect />
        </Field>
      </div>

      <form onSubmit={changePassword} class="form section">
        <h2 class="day-title">{t('settings.password')}</h2>
        <ErrorNotice error={error} />
        {note && <Notice kind="ok">{note}</Notice>}
        <Field label={t('settings.current')}>
          <input
            type="password"
            autocomplete="current-password"
            required
            value={current}
            onInput={(e) => setCurrent(inputValue(e))}
          />
        </Field>
        <Field label={t('settings.new')} hint={t('password.hint')}>
          <input
            type="password"
            autocomplete="new-password"
            required
            minLength={10}
            value={next}
            onInput={(e) => setNext(inputValue(e))}
          />
        </Field>
        <div class="actions">
          <button type="submit" class="btn btn-quiet" disabled={busy}>
            {t('settings.change')}
          </button>
        </div>
      </form>

      <div class="form section">
        <h2 class="day-title">{t('settings.data')}</h2>
        <ErrorNotice error={exportError} />
        <p class="muted">{t('settings.export.hint')}</p>
        <div class="actions">
          <button type="button" class="btn btn-quiet" disabled={busy} onClick={exportData}>
            {t('settings.export')}
          </button>
        </div>
      </div>

      <div class="form section">
        <p class="muted" dir="auto">
          {t('settings.signedInAs', { email })}
        </p>
        <div class="actions">
          <button type="button" class="btn-text" onClick={signOut}>
            {t('settings.signout')}
          </button>
          {!leaving && (
            <button type="button" class="btn-text danger" onClick={() => setLeaving(true)}>
              {t('settings.delete')}
            </button>
          )}
        </div>
        {leaving && (
          <form onSubmit={deleteAccount} class="form danger-zone">
            <p>{t('settings.delete.hint')}</p>
            <ErrorNotice error={leaveError} />
            <Field label={t('settings.current')}>
              <input
                type="password"
                autocomplete="current-password"
                required
                autofocus
                value={leavePassword}
                onInput={(e) => setLeavePassword(inputValue(e))}
              />
            </Field>
            <div class="actions">
              <button type="submit" class="btn btn-danger" disabled={busy}>
                {t('settings.delete.submit')}
              </button>
              <button type="button" class="btn-text" onClick={() => setLeaving(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
