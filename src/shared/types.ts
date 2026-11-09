import type { ChannelType } from './channels';
import type { Repeat } from './time';

export type MessageStatus = 'scheduled' | 'sending' | 'sent' | 'failed';

export interface AppState {
  /** SECRET_KEY is present on the worker. */
  configured: boolean;
  /** An owner password has been set. */
  claimed: boolean;
  signedIn: boolean;
}

export interface ChannelDTO {
  id: string;
  type: ChannelType;
  name: string;
  /** Non-secret settings only. */
  config: Record<string, string>;
  /** Keys of secret settings that have a saved value. */
  secrets: string[];
  createdAt: number;
}

export interface MessageDTO {
  id: string;
  channelId: string;
  channelName: string;
  channelType: ChannelType;
  recipient: string;
  subject: string;
  body: string;
  /** The wall time the schedule is anchored to, "YYYY-MM-DDTHH:mm". */
  localTime: string;
  timezone: string;
  repeat: Repeat;
  /** Next (or, once finished, last) scheduled instant, ms since epoch. */
  sendAt: number;
  status: MessageStatus;
  attempts: number;
  lastError: string | null;
  lastSentAt: number | null;
  sentCount: number;
  createdAt: number;
}

export interface DeliveryDTO {
  at: number;
  ok: boolean;
  detail: string | null;
}

export interface MessageInput {
  channelId: string;
  recipient?: string;
  subject?: string;
  body: string;
  localTime: string;
  timezone: string;
  repeat: Repeat;
}
