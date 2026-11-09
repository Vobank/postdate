// What each kind of channel needs in order to deliver a message.
// The worker validates against these definitions and the settings form is
// rendered from them, so adding a channel type starts here.

export const CHANNEL_TYPES = ['smtp', 'resend', 'telegram', 'discord', 'slack', 'webhook'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface FieldDef {
  key: string;
  kind: 'text' | 'email' | 'url' | 'number' | 'select' | 'multiline';
  required?: boolean;
  /** Never sent back to the browser once saved. */
  secret?: boolean;
  options?: readonly string[];
  placeholder?: string;
  default?: string;
}

export interface ChannelDef {
  fields: readonly FieldDef[];
  /** Email-like: every message names its own recipients and has a subject. */
  addressed: boolean;
  /** Longest message body the service accepts, in characters. */
  maxBody: number;
  /** The body may be left empty (a bare HTTP call, for instance). */
  bodyOptional?: boolean;
}

export const WEBHOOK_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'GET'] as const;

export const CHANNELS: Record<ChannelType, ChannelDef> = {
  smtp: {
    addressed: true,
    maxBody: 200_000,
    fields: [
      { key: 'host', kind: 'text', required: true, placeholder: 'smtp.gmail.com' },
      { key: 'port', kind: 'number', required: true, default: '587' },
      { key: 'username', kind: 'text', required: true },
      { key: 'password', kind: 'text', required: true, secret: true },
      { key: 'from_email', kind: 'email', required: true },
      { key: 'from_name', kind: 'text' },
    ],
  },
  resend: {
    addressed: true,
    maxBody: 200_000,
    fields: [
      { key: 'api_key', kind: 'text', required: true, secret: true, placeholder: 're_…' },
      { key: 'from_email', kind: 'email', required: true },
      { key: 'from_name', kind: 'text' },
    ],
  },
  telegram: {
    addressed: false,
    maxBody: 4096,
    fields: [
      { key: 'bot_token', kind: 'text', required: true, secret: true, placeholder: '123456:ABC…' },
      { key: 'chat_id', kind: 'text', required: true, placeholder: '-1001234567890' },
    ],
  },
  discord: {
    addressed: false,
    maxBody: 2000,
    fields: [
      {
        key: 'webhook_url',
        kind: 'url',
        required: true,
        secret: true,
        placeholder: 'https://discord.com/api/webhooks/…',
      },
    ],
  },
  slack: {
    addressed: false,
    maxBody: 40_000,
    fields: [
      {
        key: 'webhook_url',
        kind: 'url',
        required: true,
        secret: true,
        placeholder: 'https://hooks.slack.com/services/…',
      },
    ],
  },
  webhook: {
    addressed: false,
    maxBody: 200_000,
    bodyOptional: true,
    fields: [
      { key: 'url', kind: 'url', required: true, placeholder: 'https://example.com/hook' },
      { key: 'method', kind: 'select', required: true, options: WEBHOOK_METHODS, default: 'POST' },
      { key: 'content_type', kind: 'text', default: 'application/json' },
      { key: 'headers', kind: 'multiline', secret: true },
    ],
  },
};

export function isChannelType(value: unknown): value is ChannelType {
  return typeof value === 'string' && (CHANNEL_TYPES as readonly string[]).includes(value);
}

export type ChannelConfig = Record<string, string>;

export class ValidationError extends Error {
  constructor(
    public code: string,
    public field?: string,
  ) {
    super(code);
  }
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

export function isHttpUrl(value: string, httpsOnly = false): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || (!httpsOnly && u.protocol === 'http:');
  } catch {
    return false;
  }
}

/** Splits "a@x.com, b@y.com" into addresses, rejecting anything malformed. */
export function parseRecipients(value: string): string[] {
  const list = value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) throw new ValidationError('field_required', 'to');
  if (list.length > 50) throw new ValidationError('too_many_recipients', 'to');
  for (const address of list) {
    if (!isEmail(address)) throw new ValidationError('invalid_email', 'to');
  }
  return list;
}

/** Parses "Name: value" lines. Used by the webhook channel. */
export function parseHeaders(value: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of value.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(':');
    const name = at > 0 ? line.slice(0, at).trim() : '';
    if (!name || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
      throw new ValidationError('invalid_headers', 'headers');
    }
    out.push([name, line.slice(at + 1).trim()]);
  }
  return out;
}

/**
 * Checks submitted channel settings and returns the config to store.
 * When editing, secret fields left blank keep their previous value.
 */
export function validateChannelConfig(
  type: ChannelType,
  input: Record<string, unknown>,
  previous?: ChannelConfig,
): ChannelConfig {
  const config: ChannelConfig = {};
  for (const field of CHANNELS[type].fields) {
    const raw = input[field.key];
    let value = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '';
    value = field.kind === 'multiline' ? value.replace(/\r\n/g, '\n').trim() : value.trim();
    if (!value && field.secret && previous?.[field.key]) value = previous[field.key] ?? '';
    if (!value && field.default) value = field.default;
    if (!value) {
      if (field.required) throw new ValidationError('field_required', field.key);
      continue;
    }
    if (value.length > 4000) throw new ValidationError('too_long', field.key);
    switch (field.kind) {
      case 'email':
        if (!isEmail(value)) throw new ValidationError('invalid_email', field.key);
        break;
      case 'url':
        // Chat webhooks are always https; a custom webhook may be plain http.
        if (!isHttpUrl(value, type !== 'webhook')) throw new ValidationError('invalid_url', field.key);
        break;
      case 'number': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
          throw new ValidationError('invalid_number', field.key);
        }
        break;
      }
      case 'select':
        if (!field.options?.includes(value)) throw new ValidationError('invalid_option', field.key);
        break;
      case 'multiline':
        if (field.key === 'headers') parseHeaders(value);
        break;
      default:
        if (/[\r\n]/.test(value)) throw new ValidationError('invalid_text', field.key);
    }
    config[field.key] = value;
  }
  // Workers cannot open outbound connections on port 25.
  if (type === 'smtp' && config.port === '25') throw new ValidationError('smtp_port_25', 'port');
  return config;
}
