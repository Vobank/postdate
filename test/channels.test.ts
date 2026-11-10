import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  parseHeaders,
  parseRecipients,
  validateChannelConfig,
} from '../src/shared/channels';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationError) return `${error.code}:${error.field}`;
    throw error;
  }
  return 'ok';
};

describe('parseRecipients', () => {
  it('splits on commas, semicolons and new lines', () => {
    expect(parseRecipients('a@example.com, b@example.org;c@example.net\n')).toEqual([
      'a@example.com',
      'b@example.org',
      'c@example.net',
    ]);
  });

  it('rejects empty and malformed input', () => {
    expect(codeOf(() => parseRecipients('  '))).toBe('field_required:to');
    expect(codeOf(() => parseRecipients('a@example.com, nope'))).toBe('invalid_email:to');
    expect(codeOf(() => parseRecipients('Bob <bob@example.com>'))).toBe('invalid_email:to');
  });
});

describe('parseHeaders', () => {
  it('reads one header per line and keeps colons in values', () => {
    expect(parseHeaders('Authorization: Bearer a:b\n\nX-Thing:1')).toEqual([
      ['Authorization', 'Bearer a:b'],
      ['X-Thing', '1'],
    ]);
  });

  it('rejects lines that are not headers', () => {
    expect(codeOf(() => parseHeaders('no colon here'))).toBe('invalid_headers:headers');
    expect(codeOf(() => parseHeaders('Bad Name: x'))).toBe('invalid_headers:headers');
  });
});

describe('validateChannelConfig', () => {
  const smtp = {
    host: ' smtp.example.com ',
    port: 465,
    username: 'me@example.com',
    password: 'hunter2hunter2',
    from_email: 'me@example.com',
  };

  it('trims values and stores numbers as strings', () => {
    expect(validateChannelConfig('smtp', smtp)).toEqual({
      host: 'smtp.example.com',
      port: '465',
      username: 'me@example.com',
      password: 'hunter2hunter2',
      from_email: 'me@example.com',
    });
  });

  it('applies defaults', () => {
    const config = validateChannelConfig('webhook', { url: 'https://example.com/hook' });
    expect(config).toEqual({ url: 'https://example.com/hook', method: 'POST', content_type: 'application/json' });
  });

  it('names the missing field', () => {
    expect(codeOf(() => validateChannelConfig('smtp', { ...smtp, password: '' }))).toBe('field_required:password');
    expect(codeOf(() => validateChannelConfig('telegram', { bot_token: 'x' }))).toBe('field_required:chat_id');
  });

  it('keeps a saved secret when the field is left blank', () => {
    const previous = validateChannelConfig('smtp', smtp);
    const next = validateChannelConfig('smtp', { ...smtp, host: 'mail.example.com', password: '' }, previous);
    expect(next.password).toBe('hunter2hunter2');
    expect(next.host).toBe('mail.example.com');
  });

  it('checks formats', () => {
    expect(codeOf(() => validateChannelConfig('smtp', { ...smtp, from_email: 'nope' }))).toBe('invalid_email:from_email');
    expect(codeOf(() => validateChannelConfig('smtp', { ...smtp, port: 25 }))).toBe('smtp_port_25:port');
    expect(codeOf(() => validateChannelConfig('smtp', { ...smtp, port: 'abc' }))).toBe('invalid_number:port');
    expect(codeOf(() => validateChannelConfig('discord', { webhook_url: 'http://discord.com/x' }))).toBe('invalid_url:webhook_url');
    expect(codeOf(() => validateChannelConfig('webhook', { url: 'ftp://example.com' }))).toBe('invalid_url:url');
    expect(codeOf(() => validateChannelConfig('webhook', { url: 'http://example.com', method: 'TRACE' }))).toBe('invalid_option:method');
  });

  it('stores a switch only when it is on', () => {
    const base = { bot_token: '1:abc', chat_id: '42' };
    expect(validateChannelConfig('telegram', base)).toEqual({ ...base, format: 'plain' });
    expect(validateChannelConfig('telegram', { ...base, silent: 'true', format: 'HTML' })).toEqual({
      ...base,
      format: 'HTML',
      silent: 'true',
    });
    expect(validateChannelConfig('telegram', { ...base, silent: true }).silent).toBe('true');
    expect(validateChannelConfig('telegram', { ...base, silent: '' }).silent).toBeUndefined();
    expect(codeOf(() => validateChannelConfig('telegram', { ...base, format: 'LaTeX' }))).toBe('invalid_option:format');
  });

  it('checks the optional reply-to address', () => {
    expect(validateChannelConfig('smtp', { ...smtp, reply_to: 'team@example.com' }).reply_to).toBe('team@example.com');
    expect(codeOf(() => validateChannelConfig('smtp', { ...smtp, reply_to: 'nope' }))).toBe('invalid_email:reply_to');
  });

  it('ignores fields the channel type does not define', () => {
    const config = validateChannelConfig('slack', { webhook_url: 'https://hooks.slack.com/x', extra: 'y' });
    expect(config).toEqual({ webhook_url: 'https://hooks.slack.com/x' });
  });
});
