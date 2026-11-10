import { ValidationError, isEmail } from '../shared/channels';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto';
import { HttpError } from './http';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
/** New accounts one address may create within the window. */
const MAX_SIGNUPS = 5;
export const MIN_PASSWORD_LENGTH = 10;

export interface User {
  id: string;
  email: string;
}

// The __Host- prefix pins the cookie to this exact origin, but browsers only
// accept it over https, so plain-http local development uses another name.
function cookieName(url: URL): string {
  return url.protocol === 'https:' ? '__Host-postdate' : 'postdate';
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

function cookie(url: URL, value: string, maxAgeSeconds: number): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${cookieName(url)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function hasAccounts(db: D1Database): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS one FROM users LIMIT 1').first()) !== null;
}

/** The account behind the request's session cookie, if it has a live one. */
export async function currentUser(request: Request, db: D1Database): Promise<User | null> {
  const token = readCookie(request, cookieName(new URL(request.url)));
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1`,
    )
    .bind(await sha256Hex(token))
    .first<User & { expires_at: number }>();
  return row && row.expires_at > Date.now() ? { id: row.id, email: row.email } : null;
}

/** Starts a session and returns the Set-Cookie header value. */
export async function startSession(request: Request, db: D1Database, userId: string): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  // Only a hash is stored, so a copy of the database cannot be replayed as a login.
  await db
    .prepare('INSERT INTO sessions (token_hash, created_at, expires_at, user_id) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256Hex(token), now, now + SESSION_TTL_MS, userId)
    .run();
  return cookie(new URL(request.url), token, SESSION_TTL_MS / 1000);
}

export async function endSession(request: Request, db: D1Database): Promise<string> {
  const url = new URL(request.url);
  const token = readCookie(request, cookieName(url));
  if (token) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256Hex(token)).run();
  }
  return cookie(url, '', 0);
}

export function checkNewPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, 'password_too_short');
  if (password.length > 256) throw new HttpError(400, 'too_long');
}

/** Emails are the sign-in name. They are compared in lower case and never verified. */
function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email)) throw new ValidationError('invalid_email', 'email');
  return email;
}

function clientAddress(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

/** Refuses once `key` has used up its tries within the window. */
async function throttle(db: D1Database, key: string, max: number, now: number): Promise<void> {
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ?1 AND at > ?2')
    .bind(key, now - ATTEMPT_WINDOW_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= max) throw new HttpError(429, 'too_many_attempts');
}

async function noteAttempt(db: D1Database, key: string, now: number): Promise<void> {
  await db.prepare('INSERT INTO login_attempts (ip, at) VALUES (?1, ?2)').bind(key, now).run();
}

/**
 * Creates an account and returns its id.
 *
 * The very first account also takes over whatever an instance from before
 * accounts existed already holds, so upgrading does not orphan its messages.
 */
export async function register(
  request: Request,
  db: D1Database,
  rawEmail: string,
  password: string,
): Promise<string> {
  const now = Date.now();
  const key = `signup:${clientAddress(request)}`;
  await throttle(db, key, MAX_SIGNUPS, now);
  const email = normalizeEmail(rawEmail);
  checkNewPassword(password);

  const taken = await db.prepare('SELECT 1 AS one FROM users WHERE email = ?1').bind(email).first();
  if (taken) throw new HttpError(409, 'email_taken');

  const id = crypto.randomUUID();
  const first = '(SELECT COUNT(*) FROM users) = 1';
  try {
    await db.batch([
      db
        .prepare('INSERT INTO users (id, email, password, created_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(id, email, await hashPassword(password), now),
      db.prepare(`UPDATE channels SET user_id = ?1 WHERE user_id IS NULL AND ${first}`).bind(id),
      db.prepare(`UPDATE messages SET user_id = ?1 WHERE user_id IS NULL AND ${first}`).bind(id),
    ]);
  } catch (error) {
    // Two sign-ups with one email at the same moment: the unique index decides.
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'email_taken');
    throw error;
  }
  await noteAttempt(db, key, now);
  return id;
}

/** Checks an email and password, throttling repeated failures from one address. */
export async function signIn(
  request: Request,
  db: D1Database,
  rawEmail: string,
  password: string,
): Promise<string> {
  const ip = clientAddress(request);
  const now = Date.now();
  await throttle(db, ip, MAX_ATTEMPTS, now);

  const user = await db
    .prepare('SELECT id, password FROM users WHERE email = ?1')
    .bind(rawEmail.trim().toLowerCase())
    .first<{ id: string; password: string }>();
  if (user && password.length <= 256 && (await verifyPassword(password, user.password))) {
    await db.prepare('DELETE FROM login_attempts WHERE ip = ?1').bind(ip).run();
    return user.id;
  }
  await noteAttempt(db, ip, now);
  // One answer for an unknown email and a wrong password alike.
  throw new HttpError(401, 'wrong_login');
}

/** Confirms a signed-in user's own password before something sensitive. */
export async function confirmPassword(
  request: Request,
  db: D1Database,
  userId: string,
  password: string,
): Promise<void> {
  const ip = clientAddress(request);
  const now = Date.now();
  await throttle(db, ip, MAX_ATTEMPTS, now);
  const row = await db.prepare('SELECT password FROM users WHERE id = ?1').bind(userId).first<{
    password: string;
  }>();
  if (row && password.length <= 256 && (await verifyPassword(password, row.password))) return;
  await noteAttempt(db, ip, now);
  throw new HttpError(401, 'wrong_password');
}

export async function changePassword(db: D1Database, userId: string, next: string): Promise<void> {
  checkNewPassword(next);
  await db.batch([
    db.prepare('UPDATE users SET password = ?2 WHERE id = ?1').bind(userId, await hashPassword(next)),
    // Every session of this account is dropped; the caller starts a new one.
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId),
  ]);
}

/** Removes an account and everything that belongs to it. */
export async function deleteAccount(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM deliveries WHERE message_id IN (SELECT id FROM messages WHERE user_id = ?1)')
      .bind(userId),
    db.prepare('DELETE FROM messages WHERE user_id = ?1').bind(userId),
    db.prepare('DELETE FROM channels WHERE user_id = ?1').bind(userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?1').bind(userId),
  ]);
}

export async function pruneAuthTables(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE at < ?1').bind(now - ATTEMPT_WINDOW_MS),
  ]);
}
