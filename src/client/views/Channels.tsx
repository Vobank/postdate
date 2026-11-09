import { useEffect, useState } from 'preact/hooks';
import { CHANNELS, CHANNEL_TYPES } from '../../shared/channels';
import type { ChannelType, FieldDef } from '../../shared/channels';
import type { ChannelDTO } from '../../shared/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Link, navigate } from '../router';
import { ConfirmButton, ErrorNotice, Field, Notice, inputValue } from '../ui';

export function Channels() {
  const { t } = useI18n();
  const [channels, setChannels] = useState<ChannelDTO[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ channels: ChannelDTO[] }>('GET', '/channels')
      .then((r) => setChannels(r.channels))
      .catch(setError);
  }, []);

  if (!channels) return <ErrorNotice error={error} />;
  return (
    <>
      <div class="toolbar">
        <h1>{t('nav.channels')}</h1>
        <Link to="/channels/new" class="btn">
          {t('channels.add')}
        </Link>
      </div>
      {channels.length === 0 ? (
        <p class="empty">{t('channels.empty')}</p>
      ) : (
        <ul class="rows">
          {channels.map((c) => (
            <li key={c.id}>
              <Link to={`/channels/${c.id}`} class="row row-plain">
                <span class="row-main">
                  <span class="row-title">{c.name}</span>
                  <span class="row-meta">
                    {[t(`type.${c.type}`), c.config.from_email ?? c.config.chat_id ?? c.config.url ?? '']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function defaults(type: ChannelType): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of CHANNELS[type].fields) values[field.key] = field.default ?? '';
  return values;
}

export function ChannelForm({ id }: { id?: string }) {
  const { t } = useI18n();
  const [existing, setExisting] = useState<ChannelDTO | null>(null);
  const [type, setType] = useState<ChannelType>('smtp');
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>(defaults('smtp'));
  const [loaded, setLoaded] = useState(!id);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<{ channels: ChannelDTO[] }>('GET', '/channels')
      .then((r) => {
        const found = r.channels.find((c) => c.id === id);
        if (!found) return navigate('/channels', true);
        setExisting(found);
        setType(found.type);
        setName(found.name);
        setValues({ ...defaults(found.type), ...found.config });
        setLoaded(true);
      })
      .catch(setError);
  }, [id]);

  if (!loaded) return <ErrorNotice error={error} />;

  const chooseType = (next: ChannelType) => {
    setType(next);
    setValues(defaults(next));
  };

  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNote('');
    try {
      const body = { type, name, config: values };
      if (id) await api('PUT', `/channels/${id}`, body);
      else await api('POST', '/channels', body);
      navigate('/channels');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const test = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setNote('');
    try {
      await api('POST', `/channels/${id}/test`);
      setNote(t('channel.test.ok'));
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!id) return;
    try {
      await api('DELETE', `/channels/${id}`);
      navigate('/channels');
    } catch (e) {
      setError(e);
    }
  };

  const control = (field: FieldDef) => {
    const value = values[field.key] ?? '';
    const update = (e: Event) => setValues({ ...values, [field.key]: inputValue(e) });
    const saved = existing?.secrets.includes(field.key) ?? false;
    const required = !!field.required && !saved;
    if (field.kind === 'select') {
      return (
        <select value={value} onChange={update} dir="ltr">
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    if (field.kind === 'multiline') {
      return <textarea rows={3} class="code" dir="ltr" value={value} onInput={update} spellcheck={false} />;
    }
    const isName = field.key === 'from_name';
    const inputType = field.secret ? 'password' : field.kind === 'number' ? 'number' : field.kind === 'email' ? 'email' : 'text';
    return (
      <input
        type={inputType as 'text'}
        dir={isName ? undefined : 'ltr'}
        autocomplete={field.secret ? 'new-password' : 'off'}
        spellcheck={false}
        required={required}
        placeholder={saved ? '' : field.placeholder}
        value={value}
        onInput={update}
      />
    );
  };

  const hintFor = (field: FieldDef): string | undefined => {
    if (existing?.secrets.includes(field.key)) return t('channel.secret.saved');
    return field.key === 'headers' ? t('field.headers.hint') : undefined;
  };

  return (
    <>
      <p class="crumb">
        <Link to="/channels"><span class="arrow" aria-hidden="true">←</span> {t('nav.channels')}</Link>
      </p>
      <h1>{id ? name || t('channel.edit') : t('channels.add')}</h1>

      <form onSubmit={save} class="form">
        <ErrorNotice error={error} />
        {note && <Notice kind="ok">{note}</Notice>}

        {!id && (
          <fieldset class="types">
            <legend class="field-label">{t('channel.type')}</legend>
            {CHANNEL_TYPES.map((option) => (
              <label key={option} class="type">
                <input type="radio" name="type" checked={type === option} onChange={() => chooseType(option)} />
                <span>{t(`type.${option}`)}</span>
              </label>
            ))}
          </fieldset>
        )}
        <p class="lead">{t(`type.${type}.help`)}</p>

        <Field label={t('channel.name')} hint={t('channel.name.hint')}>
          <input type="text" required maxLength={80} value={name} onInput={(e) => setName(inputValue(e))} />
        </Field>

        {CHANNELS[type].fields.map((field) => (
          <Field key={`${type}.${field.key}`} label={t(`field.${field.key}`)} hint={hintFor(field)} optional={!field.required}>
            {control(field)}
          </Field>
        ))}

        <div class="actions">
          <button type="submit" class="btn" disabled={busy}>
            {t('channel.save')}
          </button>
          <Link to="/channels" class="btn-text">
            {t('common.cancel')}
          </Link>
        </div>
      </form>

      {id && (
        <section class="aside">
          <p class="muted">{t('channel.test.hint')}</p>
          <div class="actions">
            <button type="button" class="btn-text" disabled={busy} onClick={test}>
              {t('channel.test')}
            </button>
            <ConfirmButton label={t('channel.delete')} question={t('channel.delete.confirm')} onConfirm={remove} danger />
          </div>
        </section>
      )}
    </>
  );
}
