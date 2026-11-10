import type { ChannelType } from './channels';
import type { Repeat } from './time';

export type MessageStatus = 'scheduled' | 'paused' | 'sending' | 'sent' | 'failed';

export interface AppState {
  /** SECRET_KEY is present on the worker. */
  configured: boolean;
  signedIn: boolean;
  /** The signed-in account's email. */
  email: string | null;
  /** New accounts can be created here. */
  signups: boolean;
  /** The instance's own default language, if its owner set one. */
  lang: string | null;
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
  /** Every N days, weeks, months or years. */
  interval: number;
  /** Weekly only: days to run on, bit 0 = Sunday. Zero is the anchor's own day. */
  weekdays: number;
  /** Last local date the schedule may run on, "YYYY-MM-DD". */
  until: string | null;
  /** Stop after this many sends. */
  maxSends: number | null;
  /** Index of the next run within the schedule. */
  occurrence: number;
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
  interval?: number;
  weekdays?: number;
  until?: string | null;
  maxSends?: number | null;
}

/** Deliveries in one quarter of an hour: [start, delivered, failed]. */
export type ActivityBucket = [number, number, number];
