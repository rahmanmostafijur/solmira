import { z } from 'zod';
import type { DeliveryAttemptedPayload } from './events.js';

/**
 * The realtime delivery feed (ADR-0035). A client connects to `/ws/v1/deliveries`, sends one `auth`
 * frame with its access token, and then receives only events of the organization in that token.
 * The feed is live only: after a reconnect, load the current state from the REST API.
 */

/** The only frame a client sends. Sent as the first message, within AUTH_TIMEOUT_MS. */
export const realtimeClientFrameSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1).max(4096),
});
export type RealtimeClientFrame = z.infer<typeof realtimeClientFrameSchema>;

export const REALTIME_PATH = '/ws/v1/deliveries';
export const REALTIME_AUTH_TIMEOUT_MS = 5_000;

/** WebSocket close codes the feed uses (4000-4999 is the application range). */
export const REALTIME_CLOSE = {
  unauthenticated: 4401,
  forbidden: 4403,
  protocolError: 4400,
  /** The client could not keep up and was dropped; reconnect and reload. */
  tooSlow: 1013,
} as const;

export type RealtimeEvent =
  | {
      type: 'message.created';
      occurredAt: string;
      data: { messageId: string; applicationId: string };
    }
  | { type: 'delivery.attempted'; occurredAt: string; data: DeliveryAttemptedPayload }
  | {
      type: 'endpoint.auto_disabled';
      occurredAt: string;
      data: { endpointId: string; applicationId: string; host: string };
    };

export type RealtimeServerFrame = { type: 'ready'; organizationId: string } | RealtimeEvent;
