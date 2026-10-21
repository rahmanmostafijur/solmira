import { Receiver } from './receivers.js';
import type { Stack } from './stack.js';
import { sendMessage, type CreatedEndpoint, type Sent, type Tenant } from './tenant.js';

export interface Fixture {
  readonly tenant: Tenant;
  readonly applicationId: string;
  readonly apiKey: string;
  readonly eventType: string;
  readonly receivers: Receiver[];
  readonly endpoints: CreatedEndpoint[];
}

/** One organization, one application and one endpoint per receiver, all subscribed to one event. */
export async function createFixture(stack: Stack, receiverCount: number): Promise<Fixture> {
  const tenant = stack.tenant();
  const eventType = 'order.created';
  const eventTypeId = await tenant.createEventType(eventType);
  const applicationId = await tenant.createApplication('Resilience');
  const apiKey = await tenant.createApiKey(applicationId);
  const receivers: Receiver[] = [];
  const endpoints: CreatedEndpoint[] = [];
  for (let i = 0; i < receiverCount; i += 1) {
    const receiver = new Receiver();
    await receiver.listen();
    const endpoint = await tenant.createEndpoint(applicationId, receiver.url, [eventTypeId]);
    receiver.secret = endpoint.signingSecret;
    receivers.push(receiver);
    endpoints.push(endpoint);
  }
  return { tenant, applicationId, apiKey, eventType, receivers, endpoints };
}

export function sendAll(stack: Stack, fixture: Fixture, count: number, from = 0): Promise<Sent[]> {
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      sendMessage(stack.ingestUrl, fixture.applicationId, fixture.apiKey, fixture.eventType, {
        seq: from + i,
      }),
    ),
  );
}

export const webhookIdOf = (messageId: string) => `msg_${messageId}`;

/**
 * Send-to-receipt time, in milliseconds, of the first receipt of each of the given messages at
 * each of the given receivers. A repeat of the same webhook-id is not counted twice.
 */
export function receiptLatencies(receivers: readonly Receiver[], sent: readonly Sent[]): number[] {
  const sentAt = new Map(sent.map((message) => [webhookIdOf(message.messageId), message.sentAt]));
  return receivers.flatMap((receiver) => {
    const seen = new Set<string>();
    const latencies: number[] = [];
    for (const receipt of receiver.receipts) {
      const start = sentAt.get(receipt.webhookId);
      if (start === undefined || seen.has(receipt.webhookId)) continue;
      seen.add(receipt.webhookId);
      latencies.push(receipt.receivedAt - start);
    }
    return latencies;
  });
}
