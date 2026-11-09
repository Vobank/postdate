import { render } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { AppState } from '../shared/types';
import { ApiError, api, whenSignedOut } from './api';
import { I18nContext, initialLang, loadLang, translator, useI18n } from './i18n';
import type { I18n, Lang } from './i18n';
import { Link, useLocation } from './router';
import { ErrorNotice } from './ui';
import { ChannelForm, Channels } from './views/Channels';
import { Compose } from './views/Compose';
import { Gate } from './views/Gate';
import { Schedule } from './views/Schedule';
import { Settings } from './views/Settings';

declare const __APP_VERSION__: string;

function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const { path, query } = useLocation();
  const { t } = useI18n();
  const section = path.startsWith('/channels') ? 'channels' : path === '/settings' ? 'settings' : 'schedule';

  let view;
  const channelId = /^\/channels\/([^/]+)$/.exec(path)?.[1];
  const messageId = /^\/m\/([^/]+)$/.exec(path)?.[1];
  if (path === '/') view = <Schedule />;
  else if (path === '/new') view = <Compose key="new" copyFrom={query.get('copy') ?? undefined} />;
  else if (messageId) view = <Compose key={messageId} id={messageId} />;
  else if (path === '/channels') view = <Channels />;
  else if (channelId === 'new') view = <ChannelForm key="new" />;
  else if (channelId) view = <ChannelForm key={channelId} id={channelId} />;
  else if (path === '/settings') view = <Settings onSignedOut={onSignedOut} />;
  else view = <ErrorNotice error={new ApiError('not_found')} />;

  return (
    <div class="page">
      <header class="masthead">
        <Link to="/" class="wordmark">
          Postdate
        </Link>
        <nav class="nav">
          <Link to="/" current={section === 'schedule'}>
            {t('nav.schedule')}
          </Link>
          <Link to="/channels" current={section === 'channels'}>
            {t('nav.channels')}
          </Link>
          <Link to="/settings" current={section === 'settings'}>
            {t('nav.settings')}
          </Link>
        </nav>
      </header>
      <main>{view}</main>
      <footer class="colophon">Postdate {__APP_VERSION__}</footer>
    </div>
  );
}

function App() {
  const [lang, setLangState] = useState<Lang>('en');
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<unknown>(null);

  const setLang = useCallback((next: Lang) => {
    void loadLang(next).then(() => setLangState(next));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setState(await api<AppState>('GET', '/state'));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    const first = initialLang();
    void loadLang(first).then(() => {
      setLangState(first);
      setReady(true);
    });
    whenSignedOut(() => void refresh());
    void refresh();
  }, [refresh]);

  const i18n = useMemo<I18n>(() => ({ lang, t: translator(lang), setLang }), [lang, setLang, ready]);

  if (!ready) return null;
  return (
    <I18nContext.Provider value={i18n}>
      {error ? (
        <div class="page page-narrow">
          <ErrorNotice error={error} />
        </div>
      ) : !state ? null : state.signedIn ? (
        <Shell onSignedOut={() => void refresh()} />
      ) : (
        <Gate state={state} onDone={() => void refresh()} />
      )}
    </I18nContext.Provider>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
