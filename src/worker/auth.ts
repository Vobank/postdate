import { hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto';
import { getSetting, setSetting } from './db';
import { HttpError } from './http';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
export const MIN_PASSWORD_LENGTH = 10;

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

export async function isClaimed(db: D1Database): Promise<boolean> {
  return (await getSetting(db, 'password')) !== null;
}

export async function isSignedIn(request: Request, db: D1Database): Promise<boolean> {
  const token = readCookie(request, cookieName(new URL(request.url)));
  if (!token) return false;
  const row = await db
    .prepare('SELECT expires_at FROM sessions WHERE token_hash = ?1')
    .bind(await sha256Hex(token))
    .first<{ expires_at: number }>();
  return !!row && row.expires_at > Date.now();
}

/** Starts a session and returns the Set-Cookie header value. */
export async function startSession(request: Request, db: D1Database): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  // Only a hash is stored, so a copy of the database cannot be replayed as a login.
  await db
    .prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?1, ?2, ?3)')
    .bind(await sha256Hex(token), now, now + SESSION_TTL_MS)
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

/** Sets the owner password on a fresh instance. Fails if one already exists. */
export async function claim(db: D1Database, password: string): Promise<void> {
  checkNewPassword(password);
  const result = await db
    .prepare(`INSERT INTO settings (key, value) VALUES ('password', ?1) ON CONFLICT (key) DO NOTHING`)
    .bind(await hashPassword(password))
    .run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'already_claimed');
}

function clientAddress(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

/** Verifies the password, throttling repeated failures from one address. */
export async function checkPassword(
  request: Request,
  db: D1Database,
  password: string,
): Promise<void> {
  const ip = clientAddress(request);
  const now = Date.now();
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ?1 AND at > ?2')
    .bind(ip, now - ATTEMPT_WINDOW_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_ATTEMPTS) throw new HttpError(429, 'too_many_attempts');

  const stored = await getSetting(db, 'password');
  if (stored && password.length <= 256 && (await verifyPassword(password, stored))) {
    await db.prepare('DELETE FROM login_attempts WHERE ip = ?1').bind(ip).run();
    return;
  }
  await db.prepare('INSERT INTO login_attempts (ip, at) VALUES (?1, ?2)').bind(ip, now).run();
  throw new HttpError(401, 'wrong_password');
}

export async function changePassword(db: D1Database, next: string): Promise<void> {
  checkNewPassword(next);
  await setSetting(db, 'password', await hashPassword(next));
  // Every existing session is dropped; the caller starts a new one.
  await db.prepare('DELETE FROM sessions').run();
}

export async function pruneAuthTables(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE at < ?1').bind(now - ATTEMPT_WINDOW_MS),
  ]);
}
