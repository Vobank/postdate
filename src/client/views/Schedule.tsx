import { useEffect, useMemo, useState } from 'preact/hooks';
import { occurrencesBetween, parseLocal } from '../../shared/time';
import type { ActivityBucket, ChannelDTO, MessageDTO } from '../../shared/types';
import { api } from '../api';
import {
  DAY_MS,
  countdown,
  dayKey,
  dayLabel,
  monthLabel,
  periodLabel,
  relativeMonth,
  startOfDay,
  timeLabel,
  todayLabel,
  weekOrder,
  weekdayNames,
} from '../format';
import { useI18n } from '../i18n';
import { CheckIcon, ChannelIcon, ChevronIcon, RepeatIcon, SearchIcon } from '../icons';
import { Link } from '../router';
import { ErrorNotice, Segmented, inputValue } from '../ui';

type Tab = 'upcoming' | 'sent' | 'failed';
type View = 'list' | 'calendar';

const REFRESH_MS = 30_000;
const VIEW_KEY = 'postdate.view';
/** How far ahead the calendar can be turned. */
const MONTHS_AHEAD = 11;

/** The instant a message is filed under in a given tab. */
const when = (m: MessageDTO, tab: Tab): number => (tab === 'sent' ? (m.lastSentAt ?? m.sendAt) : m.sendAt);

function headline(m: MessageDTO): string {
  if (m.subject) return m.subject;
  const firstLine = m.body.split('\n').find((line) => line.trim());
  return firstLine?.trim().slice(0, 140) || m.channelName;
}

const matches = (m: MessageDTO, words: string[]): boolean => {
  const haystack = `${m.subject}\n${m.body}\n${m.recipient}\n${m.channelName}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
};

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch {
    return 'list';
  }
}

interface Activity {
  days: number;
  buckets: ActivityBucket[];
}

export function Schedule() {
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState<MessageDTO[] | null>(null);
  const [channels, setChannels] = useState<ChannelDTO[]>([]);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [view, setView] = useState<View>(savedView);
  const [search, setSearch] = useState('');
  const [channelId, setChannelId] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const [m, c, a] = await Promise.all([
          api<{ messages: MessageDTO[] }>('GET', '/messages'),
          api<{ channels: ChannelDTO[] }>('GET', '/channels'),
          api<Activity>('GET', '/activity'),
        ]);
        if (!alive) return;
        setMessages(m.messages);
        setChannels(c.channels);
        setActivity(a);
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

  const hasChannels = channels.length > 0;
  const groups: Record<Tab, MessageDTO[]> = {
    upcoming: messages.filter((m) => m.status === 'scheduled' || m.status === 'sending' || m.status === 'paused'),
    sent: messages.filter((m) => m.status === 'sent'),
    failed: messages.filter((m) => m.status === 'failed'),
  };
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = groups[tab].filter(
    (m) => (!channelId || m.channelId === channelId) && (words.length === 0 || matches(m, words)),
  );
  const shown = [...filtered].sort((a, b) =>
    tab === 'upcoming' ? when(a, tab) - when(b, tab) : when(b, tab) - when(a, tab),
  );
  const filtering = words.length > 0 || channelId !== '';
  const chooseView = (value: View) => {
    setView(value);
    try {
      localStorage.setItem(VIEW_KEY, value);
    } catch {
      // Remembering the view is a convenience only.
    }
  };

  const days: { key: number; items: MessageDTO[] }[] = [];
  for (const m of shown) {
    const key = dayKey(when(m, tab));
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(m);
    else days.push({ key, items: [m] });
  }

  // Nothing written yet: show the way in instead of an empty schedule.
  if (messages.length === 0) return <FirstSteps hasChannels={hasChannels} />;

  return (
    <>
      {hasChannels && (
        <section class="overview">
          <NextUp messages={groups.upcoming} />
          {activity && <ActivityChart activity={activity} />}
        </section>
      )}

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

      {hasChannels && (groups[tab].length > 0 || filtering) && (
        <div class="filters">
          <label class="search">
            <SearchIcon />
            <input
              type="search"
              placeholder={t('list.search')}
              aria-label={t('list.search')}
              value={search}
              onInput={(e) => setSearch(inputValue(e))}
            />
          </label>
          {channels.length > 1 && (
            <select
              class="filter-channel"
              aria-label={t('msg.channel')}
              value={channelId}
              onChange={(e) => setChannelId(inputValue(e))}
            >
              <option value="">{t('list.allchannels')}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {tab === 'upcoming' && (
            <Segmented
              label={`${t('view.list')} / ${t('view.calendar')}`}
              value={view}
              onChange={chooseView}
              options={[
                { value: 'list', label: t('view.list') },
                { value: 'calendar', label: t('view.calendar') },
              ]}
            />
          )}
        </div>
      )}

      {!hasChannels ? (
        <p class="empty">
          {t('list.nochannels')} <Link to="/channels/new">{t('list.addchannel')}</Link>
        </p>
      ) : tab === 'upcoming' && view === 'calendar' && (shown.length > 0 || filtering) ? (
        <Calendar messages={shown} />
      ) : shown.length === 0 ? (
        <p class="empty">{t(filtering ? 'list.nomatch' : `list.empty.${tab}`)}</p>
      ) : (
        days.map((day) => (
          <section key={day.key} class="day">
            <h2 class="day-title">{dayLabel(day.key, lang)}</h2>
            <ul class="rows">
              {day.items.map((m) => (
                <li key={m.id}>
                  <MessageRow message={m} at={when(m, tab)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

/** What a new account sees: the three steps, with the next one to take marked. */
function FirstSteps({ hasChannels }: { hasChannels: boolean }) {
  const { t } = useI18n();
  const current = hasChannels ? 2 : 1;
  return (
    <section class="start">
      <p class="eyebrow">Postdate</p>
      <h1>{t('start.title')}</h1>
      <ol class="start-steps">
        {[1, 2, 3].map((n) => (
          <li key={n} class="start-step" data-state={n < current ? 'done' : n === current ? 'current' : 'later'}>
            <span class="start-number">{n < current ? <CheckIcon /> : n}</span>
            <span class="start-title">{t(`start.${n}.title`)}</span>
            <span class="start-text">{t(`start.${n}.text`)}</span>
            {n === 1 && current === 1 && (
              <Link to="/channels/new" class="btn">
                {t('list.addchannel')}
              </Link>
            )}
            {n === 2 && current === 2 && (
              <Link to="/new" class="btn">
                {t('list.new')}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function MessageRow({ message: m, at }: { message: MessageDTO; at: number }) {
  const { t, lang } = useI18n();
  const repeats = m.repeat !== 'none';
  return (
    <Link to={`/m/${m.id}`} class={m.status === 'paused' ? 'row row-paused' : 'row'}>
      <time class="row-time" dateTime={new Date(at).toISOString()}>
        {timeLabel(at, lang)}
      </time>
      <span class="row-main">
        <span class="row-title">{headline(m)}</span>
        <span class="row-meta">
          <ChannelIcon type={m.channelType} class="icon-small" />
          <span>
            {[m.channelName, m.recipient].filter(Boolean).join(' · ')}
            {repeats && (
              <>
                {' · '}
                <RepeatIcon /> {m.interval > 1 ? periodLabel(m.repeat, m.interval, lang) : t(`repeat.${m.repeat}`)}
                {m.sentCount > 0 && ` · ${t('msg.sentcount', { n: m.sentCount })}`}
              </>
            )}
          </span>
        </span>
      </span>
      <Status message={m} />
    </Link>
  );
}

function Status({ message: m }: { message: MessageDTO }) {
  const { t } = useI18n();
  if (m.status === 'paused') return <span class="row-status badge">{t('status.paused')}</span>;
  if (m.status === 'sending') return <span class="row-status">{t('status.sending')}</span>;
  if (m.status === 'failed') return <span class="row-status bad">{t('status.failed')}</span>;
  if (m.status === 'scheduled' && m.lastError) {
    return <span class="row-status bad">{t(m.attempts > 0 ? 'status.retrying' : 'status.lastfailed')}</span>;
  }
  return null;
}

/** The message that goes out next, with a clock counting down to it. */
function NextUp({ messages }: { messages: MessageDTO[] }) {
  const { t, lang } = useI18n();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Messages whose time has come (being retried, or waiting for the next run
  // of the dispatcher) are passed over: a clock stuck at zero says nothing.
  const m = messages
    .filter((message) => message.status === 'scheduled' && message.sendAt > now)
    .reduce<MessageDTO | null>((first, message) => (!first || message.sendAt < first.sendAt ? message : first), null);

  if (!m) {
    return (
      <div class="nextup">
        <span class="eyebrow">{t('home.next')}</span>
        <span class="nextup-none">{t('list.empty.upcoming')}</span>
      </div>
    );
  }
  return (
    <Link to={`/m/${m.id}`} class="nextup">
      <span class="eyebrow">{t('home.next')}</span>
      <span class="nextup-clock" aria-live="off">
        {countdown(m.sendAt, lang, now)}
      </span>
      <span class="nextup-title">{headline(m)}</span>
      <span class="row-meta">
        <ChannelIcon type={m.channelType} class="icon-small" />
        <span>
          {m.channelName} · {dayLabel(m.sendAt, lang)}, {timeLabel(m.sendAt, lang)}
        </span>
      </span>
    </Link>
  );
}

const CHART_HEIGHT = 44;
const BAR_WIDTH = 10;
const BAR_GAP = 4;

/** One bar per day for the last two weeks: deliveries, with failures on top. */
function ActivityChart({ activity }: { activity: Activity }) {
  const { t, lang } = useI18n();
  const today = startOfDay(Date.now());
  const dayStarts = Array.from({ length: activity.days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (activity.days - 1 - i));
    return d.getTime();
  });
  const totals = dayStarts.map(() => ({ ok: 0, failed: 0 }));
  const index = new Map(dayStarts.map((start, i) => [start, i]));
  for (const [start, ok, failed] of activity.buckets) {
    const slot = totals[index.get(startOfDay(start)) ?? -1];
    if (!slot) continue;
    slot.ok += ok;
    slot.failed += failed;
  }
  const delivered = totals.reduce((sum, d) => sum + d.ok, 0);
  const failed = totals.reduce((sum, d) => sum + d.failed, 0);
  const peak = Math.max(1, ...totals.map((d) => d.ok + d.failed));
  const scale = (n: number) => (n === 0 ? 0 : Math.max(2, Math.round((n / peak) * CHART_HEIGHT)));
  const width = activity.days * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
  const dayFormat = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });

  return (
    <div class="activity">
      <span class="eyebrow">{t('home.activity', { n: activity.days })}</span>
      <svg
        class="chart"
        viewBox={`0 0 ${width} ${CHART_HEIGHT + 2}`}
        width={width}
        height={CHART_HEIGHT + 2}
        role="img"
        aria-label={`${t('home.delivered', { n: delivered })}, ${t('home.failed', { n: failed })}`}
      >
        {totals.map((day, i) => {
          const x = i * (BAR_WIDTH + BAR_GAP);
          const ok = scale(day.ok);
          const bad = scale(day.failed);
          return (
            <g key={i}>
              <title>{`${dayFormat.format(dayStarts[i])}: ${day.ok} / ${day.failed}`}</title>
              <rect class="chart-base" x={x} y={CHART_HEIGHT} width={BAR_WIDTH} height="2" />
              {ok > 0 && <rect class="chart-ok" x={x} y={CHART_HEIGHT - ok} width={BAR_WIDTH} height={ok} />}
              {bad > 0 && (
                <rect class="chart-bad" x={x} y={Math.max(0, CHART_HEIGHT - ok - bad)} width={BAR_WIDTH} height={bad} />
              )}
            </g>
          );
        })}
      </svg>
      <span class="activity-totals">
        <span>{t('home.delivered', { n: delivered })}</span>
        {failed > 0 && <span class="bad"> · {t('home.failed', { n: failed })}</span>}
      </span>
    </div>
  );
}

interface Slot {
  at: number;
  message: MessageDTO;
}

/** Every run of `m` between two instants, counting the repeats still to come. */
function runsOf(m: MessageDTO, from: number, to: number): number[] {
  if (m.repeat === 'none' || m.status === 'paused') return m.sendAt >= from && m.sendAt < to ? [m.sendAt] : [];
  const anchor = parseLocal(m.localTime);
  if (!anchor) return [];
  const left = m.maxSends === null ? 400 : Math.max(0, m.maxSends - m.sentCount);
  const rule = { interval: m.interval, weekdays: m.weekdays, until: m.until };
  return occurrencesBetween(anchor, m.timezone, m.repeat, rule, m.occurrence, m.sendAt, to, Math.min(400, left)).filter(
    (at) => at >= from,
  );
}

/** A month at a glance. Repeating messages appear on every day they will run. */
function Calendar({ messages }: { messages: MessageDTO[] }) {
  const { t, lang } = useI18n();
  const today = startOfDay(Date.now());
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState(today);

  const first = new Date(today);
  first.setDate(1);
  first.setMonth(first.getMonth() + offset);
  const year = first.getFullYear();
  const month = first.getMonth();
  const monthStart = first.getTime();
  const monthEnd = new Date(year, month + 1, 1).getTime();
  const dayCount = Math.round((monthEnd - monthStart) / DAY_MS);

  const byDay = useMemo(() => {
    const map = new Map<number, Slot[]>();
    for (const message of messages) {
      for (const at of runsOf(message, Math.max(monthStart, today), monthEnd)) {
        const key = dayKey(at);
        const list = map.get(key);
        if (list) list.push({ at, message });
        else map.set(key, [{ at, message }]);
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.at - b.at);
    return map;
  }, [messages, monthStart, monthEnd, today]);

  const order = weekOrder(lang);
  const names = weekdayNames(lang);
  const blanks = order.indexOf(first.getDay());
  const cells = Array.from({ length: dayCount }, (_, i) => new Date(year, month, i + 1).getTime());
  const selected = picked >= monthStart && picked < monthEnd ? picked : null;
  const slots = selected === null ? [] : (byDay.get(selected) ?? []);

  const turn = (by: number) => {
    const target = Math.min(MONTHS_AHEAD, Math.max(0, offset + by));
    setOffset(target);
  };

  return (
    <section class="calendar">
      <header class="calendar-head">
        <h2 class="calendar-title">{monthLabel(year, month, lang)}</h2>
        <div class="calendar-nav">
          {offset !== 0 && (
            <button
              type="button"
              class="btn-text"
              onClick={() => {
                setOffset(0);
                setPicked(today);
              }}
            >
              {todayLabel(lang)}
            </button>
          )}
          <button
            type="button"
            class="icon-btn flip"
            aria-label={relativeMonth(-1, lang)}
            disabled={offset === 0}
            onClick={() => turn(-1)}
          >
            <ChevronIcon />
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label={relativeMonth(1, lang)}
            disabled={offset === MONTHS_AHEAD}
            onClick={() => turn(1)}
          >
            <ChevronIcon />
          </button>
        </div>
      </header>

      <div class="calendar-grid" role="grid">
        {order.map((day) => (
          <span key={`name-${day}`} class="calendar-weekday" role="columnheader">
            {names[day]}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {cells.map((cell, i) => {
          const count = byDay.get(cell)?.length ?? 0;
          const classes = ['calendar-day'];
          if (cell === today) classes.push('is-today');
          if (cell < today) classes.push('is-past');
          if (count > 0) classes.push('has-items');
          return (
            <button
              key={cell}
              type="button"
              class={classes.join(' ')}
              aria-pressed={cell === selected}
              aria-label={`${dayLabel(cell, lang)}: ${count}`}
              onClick={() => setPicked(cell)}
            >
              <span class="calendar-date">{i + 1}</span>
              {count > 0 && (
                <span class="calendar-marks" aria-hidden="true">
                  {count <= 3 ? Array.from({ length: count }, (_, n) => <i key={n} />) : <b>{count}</b>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected !== null && (
        <section class="day">
          <h2 class="day-title">{dayLabel(selected, lang)}</h2>
          {slots.length === 0 ? (
            <p class="empty">{t('list.empty.upcoming')}</p>
          ) : (
            <ul class="rows">
              {slots.map((slot) => (
                <li key={`${slot.message.id}-${slot.at}`}>
                  <MessageRow message={slot.message} at={slot.at} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
