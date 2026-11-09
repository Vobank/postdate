import {
  CHANNELS,
  ValidationError,
  isChannelType,
  parseRecipients,
  validateChannelConfig,
} from '../shared/channels';
import type { ChannelConfig } from '../shared/channels';
import { REPEATS, isValidTimeZone, nextOccurrence, parseLocal, wallToUtc } from '../shared/time';
import type { Repeat } from '../shared/time';
import type { ChannelDTO, DeliveryDTO, MessageDTO } from '../shared/types';
import { seal, unseal } from './crypto';
import type { ChannelRow, MessageRow } from './db';
import { attempt, claimOne } from './dispatch';
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

async function findChannel(env: Env, id: string): Promise<ChannelRow> {
  const row = await env.DB.prepare('SELECT * FROM channels WHERE id = ?1').bind(id).first<ChannelRow>();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

function channelName(input: Record<string, unknown>): string {
  const name = str(input.name).trim();
  if (!name) throw new ValidationError('field_required', 'name');
  if (name.length > 80) throw new ValidationError('too_long', 'name');
  return name;
}

export async function listChannels(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT * FROM channels ORDER BY name COLLATE NOCASE').all<ChannelRow>();
  const channels = await Promise.all(
    rows.results.map(async (row) => channelDTO(row, await openConfig(env, row))),
  );
  return json({ channels });
}

export async function createChannel(env: Env, request: Request): Promise<Response> {
  const input = await readJson(request);
  if (!isChannelType(input.type)) throw new HttpError(400, 'bad_request');
  const name = channelName(input);
  const config = validateChannelConfig(input.type, (input.config ?? {}) as Record<string, unknown>);
  const now = Date.now();
  const row: ChannelRow = {
    id: crypto.randomUUID(),
    type: input.type,
    name,
    config: await seal(secretOf(env), config),
    created_at: now,
    updated_at: now,
  };
  await env.DB.prepare(
    'INSERT INTO channels (id, type, name, config, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)',
  )
    .bind(row.id, row.type, row.name, row.config, now)
    .run();
  return json({ channel: channelDTO(row, config) }, 201);
}

export async function updateChannel(env: Env, request: Request, id: string): Promise<Response> {
  const row = await findChannel(env, id);
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

export async function deleteChannel(env: Env, id: string): Promise<Response> {
  await findChannel(env, id);
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
export async function testChannel(env: Env, id: string): Promise<Response> {
  const row = await findChannel(env, id);
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
    sendAt: row.send_at,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    lastSentAt: row.last_sent_at,
    sentCount: row.sent_count,
    createdAt: row.created_at,
  };
}

async function findMessage(env: Env, id: string): Promise<JoinedRow> {
  const row = await env.DB.prepare(`${MESSAGE_SELECT} WHERE m.id = ?1`).bind(id).first<JoinedRow>();
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
  occurrence: number;
  sendAt: number;
}

async function prepareMessage(env: Env, input: Record<string, unknown>, now: number): Promise<Prepared> {
  const channel = await env.DB.prepare('SELECT * FROM channels WHERE id = ?1')
    .bind(str(input.channelId))
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

  let sendAt = wallToUtc(anchor, timezone);
  let occurrence = 0;
  if (repeat === 'none') {
    if (sendAt < now - PAST_GRACE_MS) throw new ValidationError('time_in_past', 'time');
  } else if (sendAt <= now) {
    // A repeating schedule that starts in the past simply begins at its next slot.
    const next = nextOccurrence(anchor, timezone, repeat, now);
    if (!next) throw new ValidationError('time_in_past', 'time');
    sendAt = next.at;
    occurrence = next.index;
  }
  return { channelId: channel.id, recipient, subject, body, localTime, timezone, repeat, occurrence, sendAt };
}

export async function listMessages(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `${MESSAGE_SELECT} ORDER BY m.send_at DESC LIMIT ${MAX_LISTED}`,
  ).all<JoinedRow>();
  return json({ messages: rows.results.map(messageDTO) });
}

export async function getMessage(env: Env, id: string): Promise<Response> {
  const row = await findMessage(env, id);
  const log = await env.DB.prepare(
    'SELECT at, ok, detail FROM deliveries WHERE message_id = ?1 ORDER BY at DESC, id DESC LIMIT 20',
  )
    .bind(id)
    .all<{ at: number; ok: number; detail: string | null }>();
  const deliveries: DeliveryDTO[] = log.results.map((d) => ({ at: d.at, ok: d.ok === 1, detail: d.detail }));
  return json({ message: messageDTO(row), deliveries });
}

export async function createMessage(env: Env, request: Request): Promise<Response> {
  const now = Date.now();
  const m = await prepareMessage(env, await readJson(request), now);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO messages (id, channel_id, recipient, subject, body, local_time, timezone, repeat,
       occurrence, send_at, due_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?11)`,
  )
    .bind(id, m.channelId, m.recipient, m.subject, m.body, m.localTime, m.timezone, m.repeat, m.occurrence, m.sendAt, now)
    .run();
  return json({ message: messageDTO(await findMessage(env, id)) }, 201);
}

/** Saving an edited message always puts it back on the schedule. */
export async function updateMessage(env: Env, request: Request, id: string): Promise<Response> {
  const now = Date.now();
  await findMessage(env, id);
  const m = await prepareMessage(env, await readJson(request), now);
  const result = await env.DB.prepare(
    `UPDATE messages SET channel_id = ?2, recipient = ?3, subject = ?4, body = ?5, local_time = ?6,
       timezone = ?7, repeat = ?8, occurrence = ?9, send_at = ?10, due_at = ?10, status = 'scheduled',
       attempts = 0, last_error = NULL, updated_at = ?11
     WHERE id = ?1 AND status != 'sending'`,
  )
    .bind(id, m.channelId, m.recipient, m.subject, m.body, m.localTime, m.timezone, m.repeat, m.occurrence, m.sendAt, now)
    .run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'busy');
  return json({ message: messageDTO(await findMessage(env, id)) });
}

export async function deleteMessage(env: Env, id: string): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM deliveries WHERE message_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM messages WHERE id = ?1').bind(id),
  ]);
  return json({ ok: true });
}

/** Sends a message immediately, whatever its schedule says. */
export async function sendMessageNow(env: Env, id: string): Promise<Response> {
  await findMessage(env, id);
  const claimed = await claimOne(env.DB, id, Date.now());
  if (!claimed) throw new HttpError(409, 'busy');
  const outcome = await attempt(env, claimed);
  const message = messageDTO(await findMessage(env, id));
  if (!outcome.ok) throw new HttpError(502, 'send_failed', { detail: outcome.detail, message });
  return json({ message });
}
