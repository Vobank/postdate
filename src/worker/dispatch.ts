import type { ChannelConfig } from '../shared/channels';
import { renderTemplate } from '../shared/template';
import { nextOccurrence, parseLocal } from '../shared/time';
import type { Rule } from '../shared/time';
import { pruneAuthTables } from './auth';
import { unseal } from './crypto';
import { ensureSchema } from './db';
import type { ChannelRow, MessageRow } from './db';
import { deliver, describeError } from './senders';

/** Messages claimed per run. Keeps one run well inside the subrequest limit. */
const BATCH_SIZE = 10;
/** Total tries for one occurrence before giving up on it. */
export const MAX_ATTEMPTS = 3;
/** Wait before the second and the third try. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];
/** A message stuck in "sending" this long belongs to a run that died. */
const STALE_LOCK_MS = 10 * 60_000;
const DELIVERY_LOG_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export interface Outcome {
  ok: boolean;
  detail: string;
}

/** What a message row should look like after one delivery attempt. */
export interface Settlement {
  status: 'scheduled' | 'sent' | 'failed';
  attempts: number;
  occurrence: number;
  sendAt: number;
  dueAt: number;
  lastError: string | null;
  sent: boolean;
}

export const ruleOf = (row: MessageRow): Rule => ({
  interval: row.interval,
  weekdays: row.weekdays,
  until: row.until,
});

/**
 * Decides what happens to a message after an attempt. Pure, so the retry and
 * recurrence rules can be tested without a database.
 */
export function settle(row: MessageRow, outcome: Outcome, now: number): Settlement {
  const anchor = parseLocal(row.local_time);
  // A schedule limited to a number of sends ends with the send that reaches it.
  const lastSend = outcome.ok && row.max_sends !== null && row.sent_count + 1 >= row.max_sends;
  const upcoming =
    anchor && row.repeat !== 'none' && !lastSend
      ? nextOccurrence(anchor, row.timezone, row.repeat, now, row.occurrence, ruleOf(row))
      : null;

  if (outcome.ok) {
    if (upcoming) {
      return {
        status: 'scheduled',
        attempts: 0,
        occurrence: upcoming.index,
        sendAt: upcoming.at,
        dueAt: upcoming.at,
        lastError: null,
        sent: true,
      };
    }
    return {
      status: 'sent',
      attempts: 0,
      occurrence: row.occurrence,
      sendAt: row.send_at,
      dueAt: row.due_at,
      lastError: null,
      sent: true,
    };
  }

  const attempts = row.attempts + 1;
  if (attempts < MAX_ATTEMPTS) {
    return {
      status: 'scheduled',
      attempts,
      occurrence: row.occurrence,
      sendAt: row.send_at,
      dueAt: now + (RETRY_DELAYS_MS[attempts - 1] ?? 5 * 60_000),
      lastError: outcome.detail,
      sent: false,
    };
  }
  // Out of tries. A repeating message skips this occurrence and carries on;
  // the error stays visible until the next successful delivery.
  if (upcoming) {
    return {
      status: 'scheduled',
      attempts: 0,
      occurrence: upcoming.index,
      sendAt: upcoming.at,
      dueAt: upcoming.at,
      lastError: outcome.detail,
      sent: false,
    };
  }
  return {
    status: 'failed',
    attempts,
    occurrence: row.occurrence,
    sendAt: row.send_at,
    dueAt: row.due_at,
    lastError: outcome.detail,
    sent: false,
  };
}

/** Sends one claimed message and records the result. Never throws. */
export async function attempt(env: Env, row: MessageRow): Promise<Outcome> {
  let outcome: Outcome;
  try {
    const channel = await env.DB.prepare('SELECT * FROM channels WHERE id = ?1')
      .bind(row.channel_id)
      .first<ChannelRow>();
    if (!channel) throw new Error('The channel this message used was deleted.');
    let config: ChannelConfig;
    try {
      config = await unseal<ChannelConfig>(env.SECRET_KEY ?? '', channel.config);
    } catch {
      throw new Error('Could not decrypt the channel settings. Has SECRET_KEY changed?');
    }
    // Variables such as {{date}} are filled in now, not when the message was written.
    const context = { now: Date.now(), timeZone: row.timezone, count: row.sent_count + 1 };
    outcome = {
      ok: true,
      detail: await deliver(channel.type, config, {
        recipient: row.recipient,
        subject: renderTemplate(row.subject, context),
        body: renderTemplate(row.body, context),
      }),
    };
  } catch (error) {
    outcome = { ok: false, detail: describeError(error) };
  }

  const now = Date.now();
  const next = settle(row, outcome, now);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE messages SET status = ?2, attempts = ?3, occurrence = ?4, send_at = ?5, due_at = ?6,
           last_error = ?7, locked_at = NULL, updated_at = ?8,
           last_sent_at = CASE WHEN ?9 THEN ?8 ELSE last_sent_at END,
           sent_count = sent_count + ?9
         WHERE id = ?1`,
      ).bind(
        row.id,
        next.status,
        next.attempts,
        next.occurrence,
        next.sendAt,
        next.dueAt,
        next.lastError,
        now,
        next.sent ? 1 : 0,
      ),
      env.DB.prepare('INSERT INTO deliveries (message_id, at, ok, detail) VALUES (?1, ?2, ?3, ?4)').bind(
        row.id,
        now,
        outcome.ok ? 1 : 0,
        outcome.detail,
      ),
    ]);
  } catch (error) {
    // The lock is left in place; the stale-lock sweep will release it.
    console.error(JSON.stringify({ event: 'settle_failed', id: row.id, error: describeError(error) }));
  }
  console.log(
    JSON.stringify({ event: 'delivery', id: row.id, ok: outcome.ok, status: next.status, detail: outcome.detail }),
  );
  return outcome;
}

/** Atomically takes ownership of one message so that two runs cannot both send it. */
export async function claimOne(db: D1Database, id: string, now: number): Promise<MessageRow | null> {
  return db
    .prepare(
      `UPDATE messages SET status = 'sending', locked_at = ?2
       WHERE id = ?1 AND status != 'sending' RETURNING *`,
    )
    .bind(id, now)
    .first<MessageRow>();
}

/** Called by the cron trigger every minute. */
export async function runDue(env: Env, now: number): Promise<void> {
  if (!env.SECRET_KEY) return;
  const db = env.DB;
  await ensureSchema(db);

  await db
    .prepare(
      `UPDATE messages SET status = 'scheduled', locked_at = NULL
       WHERE status = 'sending' AND locked_at < ?1`,
    )
    .bind(now - STALE_LOCK_MS)
    .run();

  const claimed = await db
    .prepare(
      `UPDATE messages SET status = 'sending', locked_at = ?1
       WHERE id IN (
         SELECT id FROM messages WHERE status = 'scheduled' AND due_at <= ?1
         ORDER BY due_at LIMIT ${BATCH_SIZE}
       )
       RETURNING *`,
    )
    .bind(now)
    .all<MessageRow>();

  await Promise.all(claimed.results.map((row) => attempt(env, row)));

  // Hourly housekeeping.
  if (new Date(now).getUTCMinutes() === 0) {
    await pruneAuthTables(db, now);
    await db
      .prepare('DELETE FROM deliveries WHERE at < ?1')
      .bind(now - DELIVERY_LOG_RETENTION_MS)
      .run();
  }
}
