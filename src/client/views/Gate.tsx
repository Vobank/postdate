import { useState } from 'preact/hooks';
import type { AppState } from '../../shared/types';
import { ApiError, api } from '../api';
import { useI18n } from '../i18n';
import { CheckIcon, ChevronIcon, NewAccountIcon, Postmark, StampArt } from '../icons';
import { ErrorNotice, Field, LanguageSelect, inputValue } from '../ui';

interface Props {
  state: AppState;
  onDone: () => void;
}

/**
 * Everything a visitor can see before signing in: the sign-in form first, and
 * under it the way in for someone who has no account yet.
 */
export function Gate({ state, onDone }: Props) {
  const [creating, setCreating] = useState(false);
  // What was typed into one form follows the visitor to the other.
  const [email, setEmail] = useState('');

  let view;
  if (!state.configured) view = <Unconfigured />;
  else if (creating && state.signups) {
    view = <Register email={email} setEmail={setEmail} onDone={onDone} onBack={() => setCreating(false)} />;
  } else {
    view = (
      <SignIn
        email={email}
        setEmail={setEmail}
        onDone={onDone}
        onCreate={state.signups ? () => setCreating(true) : undefined}
      />
    );
  }

  return (
    <div class="page gate">
      <header class="masthead">
        <span class="wordmark">
          <Postmark />
          Postdate
        </span>
        <LanguageSelect />
      </header>
      <div class="gate-body">
        <Pitch />
        <main class="gate-form">{view}</main>
      </div>
    </div>
  );
}

/** What Postdate is, for someone seeing it for the first time. */
function Pitch() {
  const { t } = useI18n();
  return (
    <section class="pitch">
      <StampArt />
      <p class="pitch-line">{t('gate.tagline')}</p>
      <ul class="pitch-points">
        {[1, 2, 3].map((n) => (
          <li key={n}>
            <CheckIcon />
            <span>{t(`gate.point.${n}`)}</span>
          </li>
        ))}
      </ul>
    </section>
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

interface FormProps {
  email: string;
  setEmail: (email: string) => void;
  onDone: () => void;
}

function EmailField({ email, setEmail }: Pick<FormProps, 'email' | 'setEmail'>) {
  const { t } = useI18n();
  return (
    <Field label={t('field.email')}>
      <input
        type="email"
        autocomplete="username"
        inputMode="email"
        dir="ltr"
        required
        autofocus
        value={email}
        onInput={(e) => setEmail(inputValue(e))}
      />
    </Field>
  );
}

/** `onCreate` is missing when this instance is not taking new accounts. */
function SignIn({ email, setEmail, onDone, onCreate }: FormProps & { onCreate?: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/login', { email, password });
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
      <EmailField email={email} setEmail={setEmail} />
      <Field label={t('field.password')}>
        <input
          type="password"
          autocomplete="current-password"
          required
          value={password}
          onInput={(e) => setPassword(inputValue(e))}
        />
      </Field>
      <div class="actions">
        <button type="submit" class="btn" disabled={busy}>
          {t('login.submit')}
        </button>
      </div>
      {onCreate && (
        <>
          <p class="or" aria-hidden="true">
            <span>{t('login.or')}</span>
          </p>
          <button type="button" class="invite" onClick={onCreate}>
            <span class="invite-mark">
              <NewAccountIcon />
            </span>
            <span class="invite-text">
              <span class="invite-title">{t('login.noAccount')}</span>
              <span class="invite-lead">{t('login.create')}</span>
            </span>
            <span class="invite-go">
              <ChevronIcon />
            </span>
          </button>
        </>
      )}
    </form>
  );
}

function Register({ email, setEmail, onDone, onBack }: FormProps & { onBack: () => void }) {
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
      await api('POST', '/register', { email, password });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} class="form">
      <p class="crumb">
        <button type="button" class="btn-text crumb-btn" onClick={onBack}>
          <span class="arrow">←</span> {t('setup.back')}
        </button>
      </p>
      <h1>{t('setup.title')}</h1>
      <p class="lead">{t('setup.lead')}</p>
      <ErrorNotice error={error} />
      <EmailField email={email} setEmail={setEmail} />
      <Field label={t('field.password')} hint={t('password.hint')}>
        <input
          type="password"
          autocomplete="new-password"
          required
          minLength={10}
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
