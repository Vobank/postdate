import { useState } from 'preact/hooks';
import { api } from '../api';
import { useI18n } from '../i18n';
import { ErrorNotice, Field, LanguageSelect, Notice, inputValue } from '../ui';

export function Settings({ onSignedOut }: { onSignedOut: () => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

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

      <div class="section">
        <button type="button" class="btn-text" onClick={signOut}>
          {t('settings.signout')}
        </button>
      </div>
    </>
  );
}
