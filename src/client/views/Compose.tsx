import { useEffect, useMemo, useState } from 'preact/hooks';
import { CHANNELS } from '../../shared/channels';
import { REPEATS, formatLocal, parseLocal, utcToWall, wallToUtc } from '../../shared/time';
import type { Repeat } from '../../shared/time';
import type { ChannelDTO, DeliveryDTO, MessageDTO, MessageInput } from '../../shared/types';
import { api } from '../api';
import { browserTimeZone, dateTimeLabel, relativeLabel, shortDateTime, timeZones } from '../format';
import { useI18n } from '../i18n';
import { Link, navigate } from '../router';
import { ConfirmButton, ErrorNotice, Field, Notice, inputValue } from '../ui';

const LAST_CHANNEL_KEY = 'postdate.channel';

interface Draft {
  channelId: string;
  recipient: string;
  subject: string;
  body: string;
  date: string;
  time: string;
  timezone: string;
  repeat: Repeat;
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
  };
  if (upcoming) return { ...base, ...fieldsAt(m.sendAt, m.timezone) };
  if (asCopy && m.sendAt < Date.now()) {
    const fresh = emptyDraft([]);
    return { ...base, date: fresh.date, time: fresh.time, timezone: fresh.timezone };
  }
  return { ...base, date, time };
}

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
  const sendAt = wall ? wallToUtc(wall, draft.timezone) : null;

  const preset = (ms: number) => set(fieldsAt(ms, draft.timezone));
  const tomorrowMorning = () => {
    const today = utcToWall(Date.now(), draft.timezone);
    const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    set({
      date: formatLocal({ ...today, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }).slice(0, 10),
      time: '09:00',
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

  const sendNow = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setNote('');
    try {
      await api('POST', `/messages/${id}/send`);
      setNote(t('msg.sendnow.done'));
    } catch (e) {
      setError(e);
    }
    try {
      const fresh = await api<{ message: MessageDTO; deliveries: DeliveryDTO[] }>('GET', `/messages/${id}`);
      setMessage(fresh.message);
      setDeliveries(fresh.deliveries);
    } catch {
      // The outcome above is already on screen.
    }
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

  return (
    <>
      <p class="crumb">
        <Link to="/">← {t('nav.schedule')}</Link>
      </p>
      <h1>{t(id ? 'msg.edit' : 'msg.new')}</h1>

      <form onSubmit={submit} class="form">
        <ErrorNotice error={error} />
        {note && <Notice kind="ok">{note}</Notice>}

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

        <Field label={t(channel?.type === 'webhook' ? 'msg.body.webhook' : 'msg.body')} optional={def?.bodyOptional}>
          <textarea
            rows={9}
            class={channel?.type === 'webhook' ? 'code' : undefined}
            required={!def?.bodyOptional}
            maxLength={def?.maxBody}
            value={draft.body}
            onInput={(e) => set({ body: inputValue(e) })}
          />
        </Field>

        <fieldset class="when">
          <div class="presets">
            <button type="button" class="btn-text" onClick={() => preset(Date.now() + 3_600_000)}>
              {t('msg.preset.hour')}
            </button>
            <button type="button" class="btn-text" onClick={tomorrowMorning}>
              {t('msg.preset.tomorrow')}
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
            <Field label={t('msg.repeat')}>
              <select value={draft.repeat} onChange={(e) => set({ repeat: inputValue(e) as Repeat })}>
                {REPEATS.map((r) => (
                  <option key={r} value={r}>
                    {t(`repeat.${r}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('msg.timezone')}>
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
            <ConfirmButton label={t('msg.sendnow')} question={t('msg.sendnow.confirm')} onConfirm={sendNow} disabled={busy} />
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
