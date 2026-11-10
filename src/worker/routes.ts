import {
  CHANNELS,
  ValidationError,
  isChannelType,
  parseRecipients,
  validateChannelConfig,
} from '../shared/channels';
import type { ChannelConfig } from '../shared/channels';
import {
  MAX_INTERVAL,
  REPEATS,
  isLocalDate,
  isValidTimeZone,
  nextOccurrence,
  parseLocal,
  wallToUtc,
} from '../shared/time';
import type { Repeat, Rule } from '../shared/time';
import type { ActivityBucket, ChannelDTO, DeliveryDTO, MessageDTO } from '../shared/types';
import { seal, unseal } from './crypto';
import type { ChannelRow, MessageRow } from './db';
import { attempt, claimOne, ruleOf } from './dispatch';
import { HttpError, json, readJson, str } from './http';
import { deliver, describeError } from './senders';

/** A one-off message may be this late and still be accepted (it goes out at once). */
const PAST_GRACE_MS = 5 * 60_000;
const MAX_LISTED = 500;

const secretOf = (env: Env) => env.SECRET_KEY ?? '';

async function openConfig(env: Env, row: ChannelRow): Promise<ChannelConfig> {
  try {
    return await unseal<ChannelConfig>(secretOf(env), row.config);
  } catch {
    throw new HttpError(500, 'decrypt_failed');
  }
}

function channelDTO(row: ChannelRow, config: ChannelConfig): ChannelDTO {
  const visible: Record<string, string> = {};
  const secrets: string[] = [];
  for (const field of CHANNELS[row.type].fields) {
    const value = config[field.key];
    if (!value) continue;
    if (field.secret) secrets.push(field.key);
    else visible[field.key] = value;
  }
  return { id: row.id, type: row.type, name: row.name, config: visible, secrets, createdAt: row.created_at };
}

async function findChannel(env: Env, user: string, id: string): Promise<ChannelRow> {
  const row = await env.DB.prepare('SELECT * FROM channels WHERE id = ?1 AND user_id = ?2')
    .bind(id, user)
    .first<ChannelRow>();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

function channelName(input: Record<string, unknown>): string {
  const name = str(input.name).trim();
  if (!name) throw new ValidationError('field_required', 'name');
  if (name.length > 80) throw new ValidationError('too_long', 'name');
  return name;
}

export async function listChannels(env: Env, user: string): Promise<Response> {
  const rows = await env.DB.prepare('SELECT * FROM channels WHERE user_id = ?1 ORDER BY name COLLATE NOCASE')
    .bind(user)
    .all<ChannelRow>();
  const channels = await Promise.all(
    rows.results.map(async (row) => channelDTO(row, await openConfig(env, row))),
  );
  return json({ channels });
}

export async function createChannel(env: Env, user: string, request: Request): Promise<Response> {
  const input = await readJson(request);
  if (!isChannelType(input.type)) throw new HttpError(400, 'bad_request');
  const name = channelName(input);
  const config = validateChannelConfig(input.type, (input.config ?? {}) as Record<string, unknown>);
  const now = Date.now();
  const row: ChannelRow = {
    id: crypto.randomUUID(),
    user_id: user,
    type: input.type,
    name,
    config: await seal(secretOf(env), config),
    created_at: now,
    updated_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO channels (id, type, name, config, created_at, updated_at, user_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)`,
  )
    .bind(row.id, row.type, row.name, row.config, now, user)
    .run();
  return json({ channel: channelDTO(row, config) }, 201);
}

export async function updateChannel(env: Env, user: string, request: Request, id: string): Promise<Response> {
  const row = await findChannel(env, user, id);
  const input = await readJson(request);
  const name = channelName(input);
  const config = validateChannelConfig(
    row.type,
    (input.config ?? {}) as Record<string, unknown>,
    await openConfig(env, row),
  );
  await env.DB.prepare('UPDATE channels SET name = ?2, config = ?3, updated_at = ?4 WHERE id = ?1')
    .bind(id, name, await seal(secretOf(env), config), Date.now())
    .run();
  return json({ channel: channelDTO({ ...row, name }, config) });
}

export async function deleteChannel(env: Env, user: string, id: string): Promise<Response> {
  await findChannel(env, user, id);
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE channel_id = ?1 AND status IN ('scheduled', 'sending')`,
  )
    .bind(id)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) > 0) throw new HttpError(409, 'channel_in_use');
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM deliveries WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?1)',
    ).bind(id),
    env.DB.prepare('DELETE FROM messages WHERE channel_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM channels WHERE id = ?1').bind(id),
  ]);
  return json({ ok: true });
}

/** Sends a short message right away so the settings can be checked. */
export async function testChannel(env: Env, user: string, id: string): Promise<Response> {
  const row = await findChannel(env, user, id);
  const config = await openConfig(env, row);
  const body =
    row.type === 'webhook'
      ? JSON.stringify({ text: 'Postdate test message' })
      : 'This is a test message from Postdate. The channel works.';
  try {
    await deliver(row.type, config, {
      // Email channels send the test to their own From address.
      recipient: config.from_email ?? '',
      subject: 'Postdate test message',
      body,
    });
  } catch (error) {
    throw new HttpError(502, 'send_failed', { detail: describeError(error) });
  }
  return json({ ok: true });
}

// --- Messages ---------------------------------------------------------------

const MESSAGE_SELECT = `SELECT m.*, c.name AS channel_name, c.type AS channel_type
  FROM messages m JOIN channels c ON c.id = m.channel_id`;

type JoinedRow = MessageRow & { channel_name: string; channel_type: ChannelRow['type'] };

function messageDTO(row: JoinedRow): MessageDTO {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    channelType: row.channel_type,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    localTime: row.local_time,
    timezone: row.timezone,
    repeat: row.repeat,
    interval: row.interval,
    weekdays: row.weekdays,
    until: row.until,
    maxSends: row.max_sends,
    occurrence: row.occurrence,
    sendAt: row.send_at,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    lastSentAt: row.last_sent_at,
    sentCount: row.sent_count,
    createdAt: row.created_at,
  };
}

async function findMessage(env: Env, user: string, id: string): Promise<JoinedRow> {
  const row = await env.DB.prepare(`${MESSAGE_SELECT} WHERE m.id = ?1 AND m.user_id = ?2`)
    .bind(id, user)
    .first<JoinedRow>();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

interface Prepared {
  channelId: string;
  recipient: string;
  subject: string;
  body: string;
  localTime: string;
  timezone: string;
  repeat: Repeat;
  interval: number;
  weekdays: number;
  until: string | null;
  maxSends: number | null;
  occurrence: number;
  sendAt: number;
}

/** A whole number within [min, max], or `fallback` when the field was left out. */
function wholeNumber(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError('invalid_number', field);
  return n;
}

async function prepareMessage(
  env: Env,
  user: string,
  input: Record<string, unknown>,
  now: number,
  alreadySent = 0,
): Promise<Prepared> {
  const channel = await env.DB.prepare('SELECT * FROM channels WHERE id = ?1 AND user_id = ?2')
    .bind(str(input.channelId), user)
    .first<ChannelRow>();
  if (!channel) throw new ValidationError('field_required', 'channel');
  const def = CHANNELS[channel.type];

  const body = str(input.body).replace(/\r\n/g, '\n');
  if (!body.trim() && !def.bodyOptional) throw new ValidationError('body_required', 'body');
  if (body.length > def.maxBody) throw new ValidationError('too_long', 'body');

  let recipient = '';
  let subject = '';
  if (def.addressed) {
    recipient = parseRecipients(str(input.recipient)).join(', ');
    subject = str(input.subject).replace(/[\r\n]+/g, ' ').trim();
    if (!subject) throw new ValidationError('field_required', 'subject');
    if (subject.length > 300) throw new ValidationError('too_long', 'subject');
  }

  const timezone = str(input.timezone);
  if (!isValidTimeZone(timezone)) throw new ValidationError('invalid_time', 'timezone');
  const localTime = str(input.localTime);
  const anchor = parseLocal(localTime);
  if (!anchor) throw new ValidationError('invalid_time', 'time');
  const repeat = REPEATS.find((r) => r === input.repeat);
  if (!repeat) throw new ValidationError('invalid_option', 'repeat');

  // The finer points only mean something for a repeating message.
  const repeats = repeat !== 'none';
  const interval = repeats ? wholeNumber(input.interval, 'interval', 1, MAX_INTERVAL, 1) : 1;
  const weekdays = repeat === 'weekly' ? wholeNumber(input.weekdays, 'weekdays', 0, 127, 0) : 0;
  const until = repeats && input.until ? str(input.until) : null;
  if (until !== null && !isLocalDate(until)) throw new ValidationError('invalid_time', 'until');
  const maxSends = repeats ? wholeNumber(input.maxSends, 'count', 1, 100_000, 0) || null : null;
  if (maxSends !== null && maxSends <= alreadySent) throw new ValidationError('invalid_number', 'count');
  const rule: Rule = { interval, weekdays, until };

  let sendAt = wallToUtc(anchor, timezone);
  let occurrence = 0;
  if (!repeats) {
    if (sendAt < now - PAST_GRACE_MS) throw new ValidationError('time_in_past', 'time');
  } else {
    // A repeating schedule begins at its first slot that is still ahead. That
    // is not always the anchor: the anchor may be in the past, or fall on a
    // day of the week that was not chosen.
    const next = nextOccurrence(anchor, timezone, repeat, Math.min(now, sendAt - 1), 0, rule);
    if (!next) throw new ValidationError(until ? 'invalid_time' : 'time_in_past', until ? 'until' : 'time');
    sendAt = next.at;
    occurrence = next.index;
  }
  return {
    channelId: channel.id,
    recipient,
    subject,
    body,
    localTime,
    timezone,
    repeat,
    interval,
    weekdays,
    until,
    maxSends,
    occurrence,
    sendAt,
  };
}

export async function listMessages(env: Env, user: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `${MESSAGE_SELECT} WHERE m.user_id = ?1 ORDER BY m.send_at DESC LIMIT ${MAX_LISTED}`,
  )
    .bind(user)
    .all<JoinedRow>();
  return json({ messages: rows.results.map(messageDTO) });
}

export async function getMessage(env: Env, user: string, id: string): Promise<Response> {
  const row = await findMessage(env, user, id);
  const log = await env.DB.prepare(
    'SELECT at, ok, detail FROM deliveries WHERE message_id = ?1 ORDER BY at DESC, id DESC LIMIT 20',
  )
    .bind(id)
    .all<{ at: number; ok: number; detail: string | null }>();
  const deliveries: DeliveryDTO[] = log.results.map((d) => ({ at: d.at, ok: d.ok === 1, detail: d.detail }));
  return json({ message: messageDTO(row), deliveries });
}

export async function createMessage(env: Env, user: string, request: Request): Promise<Response> {
  const now = Date.now();
  const m = await prepareMessage(env, user, await readJson(request), now);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO messages (id, channel_id, recipient, subject, body, local_time, timezone, repeat,
       occurrence, send_at, due_at, created_at, updated_at, interval, weekdays, until, max_sends, user_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?11, ?12, ?13, ?14, ?15, ?16)`,
  )
    .bind(
      id,
      m.channelId,
      m.recipient,
      m.subject,
      m.body,
      m.localTime,
      m.timezone,
      m.repeat,
      m.occurrence,
      m.sendAt,
      now,
      m.interval,
      m.weekdays,
      m.until,
      m.maxSends,
      user,
    )
    .run();
  return json({ message: messageDTO(await findMessage(env, user, id)) }, 201);
}

/** Saving an edited message puts it back on the schedule, unless it is paused. */
export async function updateMessage(env: Env, user: string, request: Request, id: string): Promise<Response> {
  const now = Date.now();
  const existing = await findMessage(env, user, id);
  const m = await prepareMessage(env, user, await readJson(request), now, existing.sent_count);
  const result = await env.DB.prepare(
    `UPDATE messages SET channel_id = ?2, recipient = ?3, subject = ?4, body = ?5, local_time = ?6,
       timezone = ?7, repeat = ?8, occurrence = ?9, send_at = ?10, due_at = ?10,
       status = CASE WHEN status = 'paused' THEN 'paused' ELSE 'scheduled' END,
       attempts = 0, last_error = NULL, updated_at = ?11,
       interval = ?12, weekdays = ?13, until = ?14, max_sends = ?15
     WHERE id = ?1 AND status != 'sending'`,
  )
    .bind(
      id,
      m.channelId,
      m.recipient,
      m.subject,
      m.body,
      m.localTime,
      m.timezone,
      m.repeat,
      m.occurrence,
      m.sendAt,
      now,
      m.interval,
      m.weekdays,
      m.until,
      m.maxSends,
    )
    .run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'busy');
  return json({ message: messageDTO(await findMessage(env, user, id)) });
}

/** Takes a message off the schedule without losing it. */
export async function pauseMessage(env: Env, user: string, id: string): Promise<Response> {
  await findMessage(env, user, id);
  const result = await env.DB.prepare(
    `UPDATE messages SET status = 'paused', attempts = 0, updated_at = ?2
     WHERE id = ?1 AND status = 'scheduled'`,
  )
    .bind(id, Date.now())
    .run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'busy');
  return json({ message: messageDTO(await findMessage(env, user, id)) });
}

/**
 * Puts a paused message back. A repeating one carries on from its next slot;
 * runs missed while it was paused are not made up for.
 */
export async function resumeMessage(env: Env, user: string, id: string): Promise<Response> {
  const row = await findMessage(env, user, id);
  if (row.status !== 'paused') throw new HttpError(409, 'busy');
  const now = Date.now();
  let sendAt = row.send_at;
  let occurrence = row.occurrence;
  if (row.repeat === 'none') {
    if (sendAt < now - PAST_GRACE_MS) throw new ValidationError('time_in_past', 'time');
  } else if (sendAt <= now) {
    const anchor = parseLocal(row.local_time);
    const next = anchor
      ? nextOccurrence(anchor, row.timezone, row.repeat, now, row.occurrence, ruleOf(row))
      : null;
    if (!next) throw new ValidationError('time_in_past', 'time');
    sendAt = next.at;
    occurrence = next.index;
  }
  await env.DB.prepare(
    `UPDATE messages SET status = 'scheduled', occurrence = ?2, send_at = ?3, due_at = ?3,
       last_error = NULL, updated_at = ?4
     WHERE id = ?1 AND status = 'paused'`,
  )
    .bind(id, occurrence, sendAt, now)
    .run();
  return json({ message: messageDTO(await findMessage(env, user, id)) });
}

export async function deleteMessage(env: Env, user: string, id: string): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM deliveries WHERE message_id IN (SELECT id FROM messages WHERE id = ?1 AND user_id = ?2)',
    ).bind(id, user),
    env.DB.prepare('DELETE FROM messages WHERE id = ?1 AND user_id = ?2').bind(id, user),
  ]);
  return json({ ok: true });
}

/** Sends a message immediately, whatever its schedule says. */
export async function sendMessageNow(env: Env, user: string, id: string): Promise<Response> {
  await findMessage(env, user, id);
  const claimed = await claimOne(env.DB, id, Date.now());
  if (!claimed) throw new HttpError(409, 'busy');
  const outcome = await attempt(env, claimed);
  const message = messageDTO(await findMessage(env, user, id));
  if (!outcome.ok) throw new HttpError(502, 'send_failed', { detail: outcome.detail, message });
  return json({ message });
}

// --- Overview ---------------------------------------------------------------

const ACTIVITY_DAYS = 14;
const QUARTER_HOUR_MS = 15 * 60_000;

/**
 * Delivery counts for the last two weeks. They come in quarter-hour buckets
 * rather than days, so the browser can group them into days of its own time
 * zone, whatever its offset.
 */
export async function activity(env: Env, user: string): Promise<Response> {
  const since = Date.now() - (ACTIVITY_DAYS + 1) * 86_400_000;
  const rows = await env.DB.prepare(
    `SELECT d.at / ${QUARTER_HOUR_MS} AS slot, SUM(d.ok) AS delivered, COUNT(*) - SUM(d.ok) AS failed
     FROM deliveries d JOIN messages m ON m.id = d.message_id
     WHERE d.at >= ?1 AND m.user_id = ?2 GROUP BY slot ORDER BY slot`,
  )
    .bind(since, user)
    .all<{ slot: number; delivered: number; failed: number }>();
  const buckets: ActivityBucket[] = rows.results.map((r) => [
    Math.floor(r.slot) * QUARTER_HOUR_MS,
    r.delivered,
    r.failed,
  ]);
  return json({ days: ACTIVITY_DAYS, buckets });
}

/** Everything this account has entered, minus the secrets. For safekeeping. */
export async function exportData(env: Env, user: string): Promise<Response> {
  const [channels, messages] = await Promise.all([
    env.DB.prepare('SELECT * FROM channels WHERE user_id = ?1 ORDER BY created_at')
      .bind(user)
      .all<ChannelRow>(),
    env.DB.prepare(`${MESSAGE_SELECT} WHERE m.user_id = ?1 ORDER BY m.created_at`)
      .bind(user)
      .all<JoinedRow>(),
  ]);
  return json({
    app: 'postdate',
    exportedAt: new Date().toISOString(),
    channels: await Promise.all(
      channels.results.map(async (row) => channelDTO(row, await openConfig(env, row))),
    ),
    messages: messages.results.map(messageDTO),
  });
}
