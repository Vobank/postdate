import { describe, expect, it, vi } from 'vitest';

// The SMTP client imports Workers-only modules; the rules under test never touch it.
vi.mock('worker-mailer', () => ({ WorkerMailer: {} }));

import { hashPassword, seal, unseal, verifyPassword } from '../src/worker/crypto';
import type { MessageRow } from '../src/worker/db';
import { MAX_ATTEMPTS, settle } from '../src/worker/dispatch';

const at = (iso: string) => Date.parse(iso);

function row(overrides: Partial<MessageRow> = {}): MessageRow {
  const sendAt = at('2027-05-10T09:00:00Z');
  return {
    id: 'm1',
    channel_id: 'c1',
    recipient: '',
    subject: '',
    body: 'hello',
    local_time: '2027-05-10T09:00',
    timezone: 'UTC',
    repeat: 'none',
    occurrence: 0,
    send_at: sendAt,
    due_at: sendAt,
    status: 'sending',
    attempts: 0,
    last_error: null,
    last_sent_at: null,
    sent_count: 0,
    locked_at: sendAt,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

const ok = { ok: true, detail: 'HTTP 200' };
const fail = { ok: false, detail: 'HTTP 500' };
const now = at('2027-05-10T09:00:20Z');

describe('settle', () => {
  it('marks a one-off message as sent', () => {
    expect(settle(row(), ok, now)).toMatchObject({ status: 'sent', sent: true, lastError: null });
  });

  it('moves a repeating message to its next slot', () => {
    const next = settle(row({ repeat: 'daily' }), ok, now);
    expect(next).toMatchObject({ status: 'scheduled', occurrence: 1, attempts: 0, sent: true });
    expect(next.sendAt).toBe(at('2027-05-11T09:00:00Z'));
    expect(next.dueAt).toBe(next.sendAt);
  });

  it('retries a failure after a minute, then after five', () => {
    const first = settle(row(), fail, now);
    expect(first).toMatchObject({ status: 'scheduled', attempts: 1, lastError: 'HTTP 500', sent: false });
    expect(first.dueAt).toBe(now + 60_000);
    expect(first.sendAt).toBe(row().send_at);

    const second = settle(row({ attempts: 1 }), fail, now);
    expect(second.dueAt).toBe(now + 5 * 60_000);
  });

  it('gives up on a one-off message after the last try', () => {
    const last = settle(row({ attempts: MAX_ATTEMPTS - 1 }), fail, now);
    expect(last).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, sent: false });
  });

  it('skips a failed occurrence of a repeating message but keeps the error', () => {
    const last = settle(row({ repeat: 'weekly', attempts: MAX_ATTEMPTS - 1 }), fail, now);
    expect(last).toMatchObject({ status: 'scheduled', attempts: 0, occurrence: 1, lastError: 'HTTP 500' });
    expect(last.sendAt).toBe(at('2027-05-17T09:00:00Z'));
  });

  it('does not skip ahead when a repeating message is sent early by hand', () => {
    const early = at('2027-05-09T12:00:00Z');
    const next = settle(row({ repeat: 'daily' }), ok, early);
    expect(next).toMatchObject({ status: 'scheduled', occurrence: 0 });
    expect(next.sendAt).toBe(row().send_at);
  });
});

describe('crypto', () => {
  it('seals and unseals a value', async () => {
    const sealed = await seal('a-long-enough-secret', { token: 'abc', n: 1 });
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('abc');
    expect(await unseal('a-long-enough-secret', sealed)).toEqual({ token: 'abc', n: 1 });
  });

  it('uses a fresh nonce every time', async () => {
    expect(await seal('k'.repeat(32), 'same')).not.toBe(await seal('k'.repeat(32), 'same'));
  });

  it('refuses to unseal with another key or after tampering', async () => {
    const sealed = await seal('first-secret-value', 'x');
    await expect(unseal('second-secret-value', sealed)).rejects.toThrow();
    await expect(unseal('first-secret-value', `${sealed.slice(0, -4)}AAAA`)).rejects.toThrow();
  });

  it('verifies only the right password', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored.startsWith('pbkdf2-sha256$100000$')).toBe(true);
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterz', stored)).toBe(false);
    expect(await verifyPassword('anything', 'garbage')).toBe(false);
  });
});
