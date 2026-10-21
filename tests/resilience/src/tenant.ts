import { randomUUID } from 'node:crypto';
import { permissionsForRole } from '@solmira/contracts';
import type { TestIssuer } from '@solmira/service-kit/testing';

export interface CreatedEndpoint {
  readonly id: string;
  readonly signingSecret: string;
}

export interface Sent {
  readonly messageId: string;
  /** When the request was sent and when the API answered, in epoch milliseconds. */
  readonly sentAt: number;
  readonly acceptedAt: number;
  readonly status: number;
}

/** One organization and the calls a customer makes: set up, then send events. */
export class Tenant {
  readonly organizationId = randomUUID();
  private tokenPromise: Promise<string> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly issuer: TestIssuer,
  ) {}

  private token(): Promise<string> {
    this.tokenPromise ??= this.issuer.sign(
      {
        userId: randomUUID(),
        sessionId: randomUUID(),
        organizationId: this.organizationId,
        role: 'OWNER',
        permissions: permissionsForRole('OWNER'),
      },
      { expiresInSeconds: 3600 },
    );
    return this.tokenPromise;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method,
      headers: {
        authorization: `Bearer ${await this.token()}`,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  async createEventType(name: string): Promise<string> {
    return (await this.call<{ id: string }>('POST', '/event-types', { name })).id;
  }

  async createApplication(name: string): Promise<string> {
    return (await this.call<{ id: string }>('POST', '/applications', { name })).id;
  }

  async createEndpoint(
    applicationId: string,
    url: string,
    eventTypeIds: string[],
  ): Promise<CreatedEndpoint> {
    return this.call<CreatedEndpoint>('POST', `/applications/${applicationId}/endpoints`, {
      url,
      eventTypeIds,
    });
  }

  async createApiKey(applicationId: string): Promise<string> {
    const created = await this.call<{ key: string }>(
      'POST',
      `/applications/${applicationId}/api-keys`,
      { name: 'resilience', scopes: ['messages:write'] },
    );
    return created.key;
  }
}

/** Sends one event through the ingestion API with an API key. */
export async function sendMessage(
  baseUrl: string,
  applicationId: string,
  apiKey: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<Sent> {
  const sentAt = Date.now();
  const response = await fetch(`${baseUrl}/applications/${applicationId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({ eventType, payload }),
  });
  const acceptedAt = Date.now();
  const text = await response.text();
  const id = response.ok ? (JSON.parse(text) as { id: string }).id : '';
  return { messageId: id, sentAt, acceptedAt, status: response.status };
}
