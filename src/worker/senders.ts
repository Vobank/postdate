import { WorkerMailer } from 'worker-mailer';
import { parseHeaders, parseRecipients } from '../shared/channels';
import type { ChannelConfig, ChannelType } from '../shared/channels';

export interface Outgoing {
  recipient: string;
  subject: string;
  body: string;
}

type Sender = (config: ChannelConfig, message: Outgoing) => Promise<string>;

const TIMEOUT_MS = 20_000;

/** Reads at most `limit` characters of a response, so a huge error page cannot fill memory. */
async function snippet(response: Response, limit = 300): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text.slice(0, limit).replace(/\s+/g, ' ').trim();
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const detail = await snippet(response);
    throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
  }
  return response;
}

const postJson = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

async function finish(response: Response): Promise<string> {
  await response.body?.cancel();
  return `HTTP ${response.status}`;
}

const need = (config: ChannelConfig, key: string): string => {
  const value = config[key];
  if (!value) throw new Error(`Channel setting "${key}" is missing.`);
  return value;
};

const smtp: Sender = async (config, message) => {
  const port = Number(need(config, 'port'));
  // 465 is TLS from the first byte; every other port starts plain and upgrades.
  const implicitTls = port === 465;
  await WorkerMailer.send(
    {
      host: need(config, 'host'),
      port,
      secure: implicitTls,
      startTls: !implicitTls,
      credentials: { username: need(config, 'username'), password: need(config, 'password') },
      authType: ['plain', 'login'],
      socketTimeoutMs: TIMEOUT_MS,
      responseTimeoutMs: TIMEOUT_MS,
    },
    {
      from: { name: config.from_name || undefined, email: need(config, 'from_email') },
      to: parseRecipients(message.recipient),
      subject: message.subject,
      text: message.body,
    },
  );
  return 'Accepted by the SMTP server';
};

const resend: Sender = async (config, message) => {
  const address = need(config, 'from_email');
  const from = config.from_name ? `${config.from_name.replace(/[<>"]/g, '')} <${address}>` : address;
  const response = await postJson(
    'https://api.resend.com/emails',
    {
      from,
      to: parseRecipients(message.recipient),
      subject: message.subject,
      text: message.body,
    },
    { authorization: `Bearer ${need(config, 'api_key')}` },
  );
  return finish(response);
};

const telegram: Sender = async (config, message) => {
  const token = need(config, 'bot_token');
  try {
    const response = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: need(config, 'chat_id'),
      text: message.body,
    });
    return await finish(response);
  } catch (error) {
    // The token is part of the URL; make sure it never ends up in a log line.
    throw new Error(describeError(error).split(token).join('…'));
  }
};

const discord: Sender = async (config, message) =>
  finish(await postJson(need(config, 'webhook_url'), { content: message.body }));

const slack: Sender = async (config, message) =>
  finish(await postJson(need(config, 'webhook_url'), { text: message.body }));

const webhook: Sender = async (config, message) => {
  const method = config.method || 'POST';
  const headers = new Headers(parseHeaders(config.headers ?? ''));
  const hasBody = method !== 'GET' && message.body.length > 0;
  if (hasBody && !headers.has('content-type')) {
    headers.set('content-type', config.content_type || 'application/json');
  }
  const response = await request(need(config, 'url'), {
    method,
    headers,
    body: hasBody ? message.body : undefined,
  });
  return finish(response);
};

const SENDERS: Record<ChannelType, Sender> = { smtp, resend, telegram, discord, slack, webhook };

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'Timed out waiting for a reply.';
    return error.message.slice(0, 500);
  }
  return String(error).slice(0, 500);
}

/** Delivers one message. Resolves with a short note for the log, rejects on failure. */
export function deliver(type: ChannelType, config: ChannelConfig, message: Outgoing): Promise<string> {
  return SENDERS[type](config, message);
}
