import { useState } from 'preact/hooks';
import type { AppState } from '../../shared/types';
import { ApiError, api } from '../api';
import { useI18n } from '../i18n';
import { ErrorNotice, Field, LanguageSelect, inputValue } from '../ui';

interface Props {
  state: AppState;
  onDone: () => void;
}

/** Everything a visitor can see before signing in. */
export function Gate({ state, onDone }: Props) {
  return (
    <div class="page page-narrow">
      <header class="masthead">
        <span class="wordmark">Postdate</span>
      </header>
      <main>
        {!state.configured ? <Unconfigured /> : state.claimed ? <SignIn onDone={onDone} /> : <Claim onDone={onDone} />}
      </main>
      <footer class="colophon">
        <LanguageSelect />
      </footer>
    </div>
  );
}

function Unconfigured() {
  const { t } = useI18n();
  return (
    <>
      <h1>{t('unconfigured.title')}</h1>
      <p class="lead">{t('unconfigured.lead')}</p>
      <pre class="command" dir="ltr">npx wrangler secret put SECRET_KEY</pre>
    </>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/login', { password });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} class="form">
      <h1>{t('login.title')}</h1>
      <ErrorNotice error={error} />
      <Field label={t('field.password')}>
        <input
          type="password"
          autocomplete="current-password"
          required
          autofocus
          value={password}
          onInput={(e) => setPassword(inputValue(e))}
        />
      </Field>
      <div class="actions">
        <button type="submit" class="btn" disabled={busy}>
          {t('login.submit')}
        </button>
      </div>
    </form>
  );
}

function Claim({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (password !== again) {
      setError(new ApiError('password_mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/setup', { password });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} class="form">
      <h1>{t('setup.title')}</h1>
      <p class="lead">{t('setup.lead')}</p>
      <ErrorNotice error={error} />
      <Field label={t('field.password')} hint={t('password.hint')}>
        <input
          type="password"
          autocomplete="new-password"
          required
          minLength={10}
          autofocus
          value={password}
          onInput={(e) => setPassword(inputValue(e))}
        />
      </Field>
      <Field label={t('setup.repeat')}>
        <input
          type="password"
          autocomplete="new-password"
          required
          value={again}
          onInput={(e) => setAgain(inputValue(e))}
        />
      </Field>
      <div class="actions">
        <button type="submit" class="btn" disabled={busy}>
          {t('setup.submit')}
        </button>
      </div>
    </form>
  );
}
