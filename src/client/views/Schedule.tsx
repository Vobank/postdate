import { useEffect, useState } from 'preact/hooks';
import type { ChannelDTO, MessageDTO } from '../../shared/types';
import { api } from '../api';
import { dayKey, dayLabel, timeLabel } from '../format';
import { useI18n } from '../i18n';
import { Link } from '../router';
import { ErrorNotice } from '../ui';

type Tab = 'upcoming' | 'sent' | 'failed';

const REFRESH_MS = 30_000;

/** The instant a message is filed under in a given tab. */
const when = (m: MessageDTO, tab: Tab): number => (tab === 'sent' ? (m.lastSentAt ?? m.sendAt) : m.sendAt);

function headline(m: MessageDTO): string {
  if (m.subject) return m.subject;
  const firstLine = m.body.split('\n').find((line) => line.trim());
  return firstLine?.trim().slice(0, 140) || m.channelName;
}

export function Schedule() {
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState<MessageDTO[] | null>(null);
  const [hasChannels, setHasChannels] = useState(true);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const [m, c] = await Promise.all([
          api<{ messages: MessageDTO[] }>('GET', '/messages'),
          api<{ channels: ChannelDTO[] }>('GET', '/channels'),
        ]);
        if (!alive) return;
        setMessages(m.messages);
        setHasChannels(c.channels.length > 0);
        setError(null);
      } catch (e) {
        if (alive) setError(e);
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  if (error && !messages) return <ErrorNotice error={error} />;
  if (!messages) return null;

  const groups: Record<Tab, MessageDTO[]> = {
    upcoming: messages.filter((m) => m.status === 'scheduled' || m.status === 'sending'),
    sent: messages.filter((m) => m.status === 'sent'),
    failed: messages.filter((m) => m.status === 'failed'),
  };
  const shown = [...groups[tab]].sort((a, b) =>
    tab === 'upcoming' ? when(a, tab) - when(b, tab) : when(b, tab) - when(a, tab),
  );

  const days: { key: number; items: MessageDTO[] }[] = [];
  for (const m of shown) {
    const key = dayKey(when(m, tab));
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(m);
    else days.push({ key, items: [m] });
  }

  return (
    <>
      <div class="toolbar">
        <div class="tabs" role="tablist">
          {(['upcoming', 'sent', 'failed'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              class="tab"
              onClick={() => setTab(name)}
            >
              {t(`list.${name}`)}
              <span class="tab-count">{groups[name].length}</span>
            </button>
          ))}
        </div>
        {hasChannels && (
          <Link to="/new" class="btn">
            {t('list.new')}
          </Link>
        )}
      </div>

      <ErrorNotice error={error} />

      {!hasChannels ? (
        <p class="empty">
          {t('list.nochannels')} <Link to="/channels/new">{t('list.addchannel')}</Link>
        </p>
      ) : shown.length === 0 ? (
        <p class="empty">{t(`list.empty.${tab}`)}</p>
      ) : (
        days.map((day) => (
          <section key={day.key} class="day">
            <h2 class="day-title">{dayLabel(day.key, lang)}</h2>
            <ul class="rows">
              {day.items.map((m) => (
                <li key={m.id}>
                  <Link to={`/m/${m.id}`} class="row">
                    <time class="row-time" dateTime={new Date(when(m, tab)).toISOString()}>
                      {timeLabel(when(m, tab), lang)}
                    </time>
                    <span class="row-main">
                      <span class="row-title">{headline(m)}</span>
                      <span class="row-meta">
                        {[
                          m.channelName,
                          m.recipient,
                          m.repeat !== 'none' ? t(`repeat.${m.repeat}`) : '',
                          m.repeat !== 'none' && m.sentCount > 0 ? t('msg.sentcount', { n: m.sentCount }) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <Status message={m} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function Status({ message: m }: { message: MessageDTO }) {
  const { t } = useI18n();
  if (m.status === 'sending') return <span class="row-status">{t('status.sending')}</span>;
  if (m.status === 'failed') return <span class="row-status bad">{t('status.failed')}</span>;
  if (m.status === 'scheduled' && m.lastError) {
    return <span class="row-status bad">{t(m.attempts > 0 ? 'status.retrying' : 'status.lastfailed')}</span>;
  }
  return null;
}
