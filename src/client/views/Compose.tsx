import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CHANNELS } from '../../shared/channels';
import { VARIABLES } from '../../shared/template';
import {
  MAX_INTERVAL,
  REPEATS,
  formatLocal,
  occurrencesBetween,
  parseLocal,
  utcToWall,
  wallToUtc,
  weekdayOf,
} from '../../shared/time';
import type { Repeat } from '../../shared/time';
import type { ChannelDTO, DeliveryDTO, MessageDTO, MessageInput } from '../../shared/types';
import { api } from '../api';
import {
  browserTimeZone,
  compactDateTime,
  dateTimeLabel,
  periodLabel,
  relativeLabel,
  shortDateTime,
  timeZones,
  weekOrder,
  weekdayNames,
} from '../format';
import { useI18n } from '../i18n';
import { Link, navigate } from '../router';
import { ConfirmButton, ErrorNotice, Field, Notice, inputValue } from '../ui';

const LAST_CHANNEL_KEY = 'postdate.channel';
/** How many upcoming sends of a repeating message are listed under the form. */
const PREVIEW_COUNT = 5;

type Ends = 'never' | 'date' | 'count';

interface Draft {
  channelId: string;
  recipient: string;
  subject: string;
  body: string;
  date: string;
  time: string;
  timezone: string;
  repeat: Repeat;
  interval: string;
  /** Bitmask, bit 0 = Sunday. Zero means "the day the date falls on". */
  weekdays: number;
  ends: Ends;
  until: string;
  maxSends: string;
}

/** Splits an instant into the date and time fields, as read on a clock in `timezone`. */
function fieldsAt(ms: number, timezone: string): { date: string; time: string } {
  const [date = '', time = ''] = formatLocal(utcToWall(ms, timezone)).split('T');
  return { date, time };
}

function remembered(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function emptyDraft(channels: ChannelDTO[]): Draft {
  const timezone = browserTimeZone();
  // An hour from now, rounded up to the next five minutes.
  const soon = Math.ceil((Date.now() + 3_600_000) / 300_000) * 300_000;
  const last = remembered(LAST_CHANNEL_KEY);
  return {
    channelId: channels.find((c) => c.id === last)?.id ?? channels[0]?.id ?? '',
    recipient: '',
    subject: '',
    body: '',
    ...fieldsAt(soon, timezone),
    timezone,
    repeat: 'none',
    interval: '1',
    weekdays: 0,
    ends: 'never',
    until: '',
    maxSends: '',
  };
}

function draftFrom(m: MessageDTO, asCopy: boolean): Draft {
  // A repeating message is edited at its next run, not at the day it first started.
  const upcoming = m.repeat !== 'none' && m.sendAt > Date.now();
  const [date = '', time = ''] = m.localTime.split('T');
  const base = {
    channelId: m.channelId,
    recipient: m.recipient,
    subject: m.subject,
    body: m.body,
    timezone: m.timezone,
    repeat: m.repeat,
    interval: String(m.interval),
    weekdays: m.weekdays,
    ends: (m.until ? 'date' : m.maxSends ? 'count' : 'never') as Ends,
    until: m.until ?? '',
    maxSends: m.maxSends ? String(m.maxSends) : '',
  };
  if (upcoming) return { ...base, ...fieldsAt(m.sendAt, m.timezone) };
  if (asCopy && m.sendAt < Date.now()) {
    const fresh = emptyDraft([]);
    return { ...base, date: fresh.date, time: fresh.time, timezone: fresh.timezone };
  }
  return { ...base, date, time };
}

const wholeOr = (value: string, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
};

export function Compose({ id, copyFrom }: { id?: string; copyFrom?: string }) {
  const { t, lang } = useI18n();
  const [channels, setChannels] = useState<ChannelDTO[] | null>(null);
  const [message, setMessage] = useState<MessageDTO | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryDTO[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const zones = useMemo(timeZones, []);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const source = id ?? copyFrom;
        const [c, m] = await Promise.all([
          api<{ channels: ChannelDTO[] }>('GET', '/channels'),
          source
            ? api<{ message: MessageDTO; deliveries: DeliveryDTO[] }>('GET', `/messages/${source}`)
            : Promise.resolve(null),
        ]);
        if (!alive) return;
        setChannels(c.channels);
        if (m && id) {
          setMessage(m.message);
          setDeliveries(m.deliveries);
        }
        setDraft(m ? draftFrom(m.message, !id) : emptyDraft(c.channels));
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, copyFrom]);

  if (!draft || !channels) return <ErrorNotice error={error} />;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const channel = channels.find((c) => c.id === draft.channelId);
  const def = channel ? CHANNELS[channel.type] : null;
  const wall = parseLocal(`${draft.date}T${draft.time}`);
  const repeats = draft.repeat !== 'none';
  const interval = Math.min(MAX_INTERVAL, wholeOr(draft.interval, 1));
  const sentSoFar = id && message ? message.sentCount : 0;
  const paused = message?.status === 'paused';

  // What the schedule comes to: the first few sends, worked out the same way
  // the server will. For a repeating message the first one is not always the
  // date in the form, which may be in the past or on a day that was not chosen.
  const upcoming = (() => {
    if (!wall) return [];
    if (!repeats) return [wallToUtc(wall, draft.timezone)];
    const left = draft.ends === 'count' ? Math.max(0, wholeOr(draft.maxSends, 0) - sentSoFar) : PREVIEW_COUNT + 1;
    const rule = {
      interval,
      weekdays: draft.repeat === 'weekly' ? draft.weekdays : 0,
      until: draft.ends === 'date' && draft.until ? draft.until : null,
    };
    const from = Math.min(Date.now() + 1, wallToUtc(wall, draft.timezone));
    return occurrencesBetween(wall, draft.timezone, draft.repeat, rule, 0, from, Infinity, Math.min(PREVIEW_COUNT + 1, left));
  })();
  const sendAt = upcoming[0] ?? null;

  const preset = (ms: number) => set(fieldsAt(ms, draft.timezone));
  /** 09:00 on the day `daysAhead(today's weekday)` days from now, in the chosen zone. */
  const morning = (daysAhead: (weekday: number) => number) => {
    const today = utcToWall(Date.now(), draft.timezone);
    const next = new Date(Date.UTC(today.year, today.month - 1, today.day + daysAhead(weekdayOf(today))));
    set({
      date: formatLocal({ ...today, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }).slice(0, 10),
      time: '09:00',
    });
  };

  const dayNames = weekdayNames(lang);
  const anchorDay = wall ? weekdayOf(wall) : 0;
  const chosenDays = draft.weekdays || 1 << anchorDay;
  const toggleDay = (day: number) => {
    const nextDays = chosenDays ^ (1 << day);
    // A weekly schedule runs on at least one day.
    if (nextDays !== 0) set({ weekdays: nextDays });
  };

  const insertVariable = (token: string) => {
    const area = bodyRef.current;
    const start = area?.selectionStart ?? draft.body.length;
    const end = area?.selectionEnd ?? draft.body.length;
    set({ body: draft.body.slice(0, start) + token + draft.body.slice(end) });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const input: MessageInput = {
      channelId: draft.channelId,
      recipient: draft.recipient,
      subject: draft.subject,
      body: draft.body,
      localTime: `${draft.date}T${draft.time}`,
      timezone: draft.timezone,
      repeat: draft.repeat,
      interval,
      weekdays: draft.repeat === 'weekly' ? draft.weekdays : 0,
      until: repeats && draft.ends === 'date' ? draft.until : null,
      maxSends: repeats && draft.ends === 'count' ? wholeOr(draft.maxSends, 1) : null,
    };
    try {
      await (id ? api('PUT', `/messages/${id}`, input) : api('POST', '/messages', input));
      try {
        localStorage.setItem(LAST_CHANNEL_KEY, draft.channelId);
      } catch {
        // Remembering the channel is a convenience only.
      }
      navigate('/');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const reload = async () => {
    if (!id) return;
    try {
      const fresh = await api<{ message: MessageDTO; deliveries: DeliveryDTO[] }>('GET', `/messages/${id}`);
      setMessage(fresh.message);
      setDeliveries(fresh.deliveries);
    } catch {
      // Whatever happened is already on screen.
    }
  };

  const act = async (action: 'send' | 'pause' | 'resume') => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setNote('');
    try {
      await api('POST', `/messages/${id}/${action}`);
      if (action === 'send') setNote(t('msg.sendnow.done'));
    } catch (e) {
      setError(e);
    }
    await reload();
    setBusy(false);
  };

  const remove = async () => {
    if (!id) return;
    try {
      await api('DELETE', `/messages/${id}`);
      navigate('/');
    } catch (e) {
      setError(e);
    }
  };

  const nearLimit = def ? draft.body.length > def.maxBody * 0.9 : false;

  return (
    <>
      <p class="crumb">
        <Link to="/"><span class="arrow" aria-hidden="true">←</span> {t('nav.schedule')}</Link>
      </p>
      <h1>{t(id ? 'msg.edit' : 'msg.new')}</h1>

      <form onSubmit={submit} class="form">
        <ErrorNotice error={error} />
        {note && <Notice kind="ok">{note}</Notice>}
        {paused && <Notice kind="ok">{t('msg.paused.note')}</Notice>}

        <Field label={t('msg.channel')}>
          <select required value={draft.channelId} onChange={(e) => set({ channelId: inputValue(e) })}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {t(`type.${c.type}`)}
              </option>
            ))}
          </select>
        </Field>

        {def?.addressed && (
          <>
            <Field label={t('msg.to')} hint={t('msg.to.hint')}>
              <input
                type="text"
                inputMode="email"
                autocomplete="off"
                required
                dir="ltr"
                value={draft.recipient}
                onInput={(e) => set({ recipient: inputValue(e) })}
              />
            </Field>
            <Field label={t('msg.subject')}>
              <input type="text" required maxLength={300} value={draft.subject} onInput={(e) => set({ subject: inputValue(e) })} />
            </Field>
          </>
        )}

        <div class="field">
          <Field label={t(channel?.type === 'webhook' ? 'msg.body.webhook' : 'msg.body')} optional={def?.bodyOptional}>
            <textarea
              ref={bodyRef}
              rows={9}
              class={channel?.type === 'webhook' ? 'code' : undefined}
              required={!def?.bodyOptional}
              maxLength={def?.maxBody}
              value={draft.body}
              onInput={(e) => set({ body: inputValue(e) })}
            />
          </Field>
          <div class="body-tools">
            <span class="variables" dir="ltr">
              {VARIABLES.map((token) => (
                <button key={token} type="button" class="chip code" onClick={() => insertVariable(token)}>
                  {token}
                </button>
              ))}
            </span>
            {def && (
              <span class={nearLimit ? 'counter bad' : 'counter'}>
                {draft.body.length.toLocaleString(lang)} / {def.maxBody.toLocaleString(lang)}
              </span>
            )}
          </div>
          <span class="field-hint">{t('msg.vars')}</span>
        </div>

        <fieldset class="when">
          <div class="presets">
            <button type="button" class="btn-text" onClick={() => preset(Date.now() + 3_600_000)}>
              {t('msg.preset.hour')}
            </button>
            <button type="button" class="btn-text" onClick={() => morning(() => 1)}>
              {t('msg.preset.tomorrow')}
            </button>
            <button type="button" class="btn-text" onClick={() => morning((weekday) => ((8 - weekday) % 7) || 7)}>
              {t('msg.preset.monday')}
            </button>
            <button type="button" class="btn-text" onClick={() => preset(Date.now() + 7 * 86_400_000)}>
              {t('msg.preset.week')}
            </button>
          </div>
          <div class="when-grid">
            <Field label={t('msg.date')}>
              <input type="date" required value={draft.date} onInput={(e) => set({ date: inputValue(e) })} />
            </Field>
            <Field label={t('msg.time')}>
              <input type="time" required value={draft.time} onInput={(e) => set({ time: inputValue(e) })} />
            </Field>
            <Field label={t('msg.repeat')} help={t('help.repeat')}>
              <select value={draft.repeat} onChange={(e) => set({ repeat: inputValue(e) as Repeat })}>
                {REPEATS.map((r) => (
                  <option key={r} value={r}>
                    {t(`repeat.${r}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {repeats && (
            <div class="when-grid when-rule">
              <Field label={t('msg.interval')} hint={periodLabel(draft.repeat, interval, lang)}>
                <input
                  type="number"
                  required
                  min={1}
                  max={MAX_INTERVAL}
                  step={1}
                  inputMode="numeric"
                  value={draft.interval}
                  onInput={(e) => set({ interval: inputValue(e) })}
                />
              </Field>
              <Field label={t('msg.ends')}>
                <select value={draft.ends} onChange={(e) => set({ ends: inputValue(e) as Ends })}>
                  <option value="never">{t('ends.never')}</option>
                  <option value="date">{t('ends.date')}</option>
                  <option value="count">{t('ends.count')}</option>
                </select>
              </Field>
              {draft.ends === 'date' && (
                <Field label={t('msg.until')}>
                  <input
                    type="date"
                    required
                    min={draft.date}
                    value={draft.until}
                    onInput={(e) => set({ until: inputValue(e) })}
                  />
                </Field>
              )}
              {draft.ends === 'count' && (
                <Field label={t('msg.count')} hint={sentSoFar > 0 ? t('msg.sentcount', { n: sentSoFar }) : undefined}>
                  <input
                    type="number"
                    required
                    min={sentSoFar + 1}
                    max={100000}
                    step={1}
                    inputMode="numeric"
                    value={draft.maxSends}
                    onInput={(e) => set({ maxSends: inputValue(e) })}
                  />
                </Field>
              )}
            </div>
          )}

          {draft.repeat === 'weekly' && (
            <div class="field">
              <span class="field-label" id="weekdays-label">
                {t('msg.weekdays')}
              </span>
              <div class="weekdays" role="group" aria-labelledby="weekdays-label">
                {weekOrder(lang).map((day) => (
                  <button
                    key={day}
                    type="button"
                    class="chip"
                    aria-pressed={(chosenDays & (1 << day)) !== 0}
                    onClick={() => toggleDay(day)}
                  >
                    {dayNames[day]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Field label={t('msg.timezone')} help={t('help.timezone')}>
            <select dir="ltr" value={draft.timezone} onChange={(e) => set({ timezone: inputValue(e) })}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          {sendAt !== null && (
            <p class="when-summary">
              {dateTimeLabel(sendAt, lang, draft.timezone)}
              <span class="muted"> · {relativeLabel(sendAt, lang)}</span>
            </p>
          )}
          {repeats && upcoming.length > 1 && (
            <div class="preview">
              <span class="eyebrow">{t('msg.nextsends')}</span>
              <ol class="preview-list">
                {upcoming.slice(1, PREVIEW_COUNT).map((at) => (
                  <li key={at}>{compactDateTime(at, lang, draft.timezone)}</li>
                ))}
                {upcoming.length > PREVIEW_COUNT && <li aria-hidden="true">…</li>}
              </ol>
            </div>
          )}
        </fieldset>

        <div class="actions">
          <button type="submit" class="btn" disabled={busy}>
            {t(id ? 'msg.save' : 'msg.schedule')}
          </button>
          <Link to="/" class="btn-text">
            {t('common.cancel')}
          </Link>
        </div>
      </form>

      {id && message && (
        <section class="aside">
          {message.lastError && (
            <Notice kind="error">
              {t('msg.lasterror')}: {message.lastError}
            </Notice>
          )}
          <div class="actions">
            {!paused && (
              <ConfirmButton
                label={t('msg.sendnow')}
                question={t('msg.sendnow.confirm')}
                onConfirm={() => void act('send')}
                disabled={busy}
              />
            )}
            {message.status === 'scheduled' && (
              <button type="button" class="btn-text" disabled={busy} onClick={() => void act('pause')}>
                {t('msg.pause')}
              </button>
            )}
            {paused && (
              <button type="button" class="btn-text" disabled={busy} onClick={() => void act('resume')}>
                {t('msg.resume')}
              </button>
            )}
            <Link to={`/new?copy=${id}`} class="btn-text">
              {t('msg.duplicate')}
            </Link>
            <ConfirmButton label={t('msg.delete')} question={t('msg.delete.confirm')} onConfirm={remove} danger />
          </div>

          {deliveries.length > 0 && (
            <>
              <h2 class="day-title">{t('msg.log')}</h2>
              <ul class="log">
                {deliveries.map((d, i) => (
                  <li key={i}>
                    <time class="log-time">{shortDateTime(d.at, lang)}</time>
                    <span class={d.ok ? 'good' : 'bad'}>{t(d.ok ? 'msg.log.ok' : 'msg.log.fail')}</span>
                    {d.detail && <span class="log-detail" dir="ltr">{d.detail}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
