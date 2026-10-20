import { signWebhook } from '@solmira/webhooks';

export const USER_AGENT = 'Solmira-Webhooks/1.0';

export interface DeliveryRequest {
  readonly body: string;
  readonly headers: Record<string, string>;
}

export interface BuildRequestInput {
  readonly messageId: string;
  readonly payload: unknown;
  /** The tenant's custom headers; the platform's own headers always win. */
  readonly customHeaders: Readonly<Record<string, string>>;
  /** The active secret, plus the previous one during a rotation window (Phase 7). */
  readonly secrets: readonly string[];
  readonly now: Date;
}

/** `msg_<message id>`: stable across attempts, retries and replays, so receivers can deduplicate. */
export const webhookIdOf = (messageId: string): string => 'msg_' + messageId;

/**
 * The request a receiver sees (ADR-0031): the payload as JSON, the Standard Webhooks headers, the
 * tenant's custom headers and a fixed user agent. The timestamp is new for every attempt; the id
 * is not.
 */
export function buildDeliveryRequest(input: BuildRequestInput): DeliveryRequest {
  const body = JSON.stringify(input.payload);
  const signed = signWebhook({
    id: webhookIdOf(input.messageId),
    timestamp: Math.floor(input.now.getTime() / 1000),
    body,
    secrets: input.secrets,
  });
  return {
    body,
    headers: {
      ...input.customHeaders,
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      ...signed,
    },
  };
}
