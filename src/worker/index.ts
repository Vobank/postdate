import { ValidationError } from '../shared/channels';
import type { AppState } from '../shared/types';
import {
  changePassword,
  confirmPassword,
  currentUser,
  deleteAccount,
  endSession,
  hasAccounts,
  register,
  signIn,
  startSession,
} from './auth';
import { ensureSchema } from './db';
import { runDue } from './dispatch';
import { HttpError, json, readJson, str } from './http';
import * as routes from './routes';

const isConfigured = (env: Env) => typeof env.SECRET_KEY === 'string' && env.SECRET_KEY.length >= 16;

/** New accounts can be made unless SIGNUPS is "closed"; the first one always can. */
const signupsOpen = async (env: Env, db: D1Database) => env.SIGNUPS !== 'closed' || !(await hasAccounts(db));

/**
 * State-changing requests must carry a custom header and, when the browser
 * sends one, a same-origin Origin. Together with the SameSite=Strict cookie
 * this shuts out cross-site form posts.
 */
function assertSameOrigin(request: Request, url: URL): void {
  if (request.headers.get('x-postdate') !== '1') throw new HttpError(403, 'forbidden');
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    // The Vite dev server proxies /api and rewrites the host; allow that locally.
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!local) throw new HttpError(403, 'forbidden');
  }
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.startsWith('/api/')) throw new HttpError(404, 'not_found');
  if (method !== 'GET') assertSameOrigin(request, url);

  const db = env.DB;
  await ensureSchema(db);
  const route = `${method} ${path}`;

  if (route === 'GET /api/state') {
    const configured = isConfigured(env);
    const account = configured ? await currentUser(request, db) : null;
    const state: AppState = {
      configured,
      signedIn: account !== null,
      email: account?.email ?? null,
      signups: await signupsOpen(env, db),
      lang: env.DEFAULT_LANG || null,
    };
    return json(state);
  }

  if (!isConfigured(env)) throw new HttpError(503, 'not_configured');

  if (route === 'POST /api/register') {
    if (!(await signupsOpen(env, db))) throw new HttpError(403, 'signups_closed');
    const body = await readJson(request);
    const id = await register(request, db, str(body.email), str(body.password));
    return json({ ok: true }, 201, { 'set-cookie': await startSession(request, db, id) });
  }
  if (route === 'POST /api/login') {
    const body = await readJson(request);
    const id = await signIn(request, db, str(body.email), str(body.password));
    return json({ ok: true }, 200, { 'set-cookie': await startSession(request, db, id) });
  }
  if (route === 'POST /api/logout') {
    return json({ ok: true }, 200, { 'set-cookie': await endSession(request, db) });
  }

  const account = await currentUser(request, db);
  if (!account) throw new HttpError(401, 'unauthorized');
  // Everything below reads and writes this account's rows only.
  const user = account.id;

  if (route === 'POST /api/password') {
    const body = await readJson(request);
    await confirmPassword(request, db, user, str(body.current));
    await changePassword(db, user, str(body.next));
    return json({ ok: true }, 200, { 'set-cookie': await startSession(request, db, user) });
  }

  if (route === 'POST /api/account/delete') {
    const body = await readJson(request);
    await confirmPassword(request, db, user, str(body.password));
    await deleteAccount(db, user);
    return json({ ok: true }, 200, { 'set-cookie': await endSession(request, db) });
  }

  if (route === 'GET /api/channels') return routes.listChannels(env, user);
  if (route === 'POST /api/channels') return routes.createChannel(env, user, request);
  if (route === 'GET /api/messages') return routes.listMessages(env, user);
  if (route === 'POST /api/messages') return routes.createMessage(env, user, request);
  if (route === 'GET /api/activity') return routes.activity(env, user);
  if (route === 'GET /api/export') return routes.exportData(env, user);

  const [, , collection, id, action] = path.split('/');
  if (id && collection === 'channels') {
    if (!action && method === 'PUT') return routes.updateChannel(env, user, request, id);
    if (!action && method === 'DELETE') return routes.deleteChannel(env, user, id);
    if (action === 'test' && method === 'POST') return routes.testChannel(env, user, id);
  }
  if (id && collection === 'messages') {
    if (!action && method === 'GET') return routes.getMessage(env, user, id);
    if (!action && method === 'PUT') return routes.updateMessage(env, user, request, id);
    if (!action && method === 'DELETE') return routes.deleteMessage(env, user, id);
    if (action === 'send' && method === 'POST') return routes.sendMessageNow(env, user, id);
    if (action === 'pause' && method === 'POST') return routes.pauseMessage(env, user, id);
    if (action === 'resume' && method === 'POST') return routes.resumeMessage(env, user, id);
  }
  throw new HttpError(404, 'not_found');
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.code, ...error.extra }, error.status);
      }
      if (error instanceof ValidationError) {
        return json({ error: error.code, field: error.field }, 400);
      }
      console.error(
        JSON.stringify({
          event: 'unhandled',
          path: new URL(request.url).pathname,
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        }),
      );
      return json({ error: 'unknown' }, 500);
    }
  },

  async scheduled(controller, env): Promise<void> {
    await runDue(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
