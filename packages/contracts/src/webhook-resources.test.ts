import { describe, expect, it } from 'vitest';
import {
  createApiKeyRequestSchema,
  createApplicationRequestSchema,
  createEndpointRequestSchema,
  createEventTypeRequestSchema,
  updateApplicationRequestSchema,
  updateEndpointRequestSchema,
} from './index.js';

const issues = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('applications', () => {
  it('trim names and reject empty updates', () => {
    expect(createApplicationRequestSchema.parse({ name: '  Production ' }).name).toBe('Production');
    expect(createApplicationRequestSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(updateApplicationRequestSchema.safeParse({}).success).toBe(false);
    expect(updateApplicationRequestSchema.safeParse({ description: null }).success).toBe(true);
  });
});

describe('event types', () => {
  it('accept dotted lowercase names and reject anything else', () => {
    for (const name of ['invoice.paid', 'user_created', 'a', 'order-2.line.shipped'])
      expect(createEventTypeRequestSchema.safeParse({ name }).success, name).toBe(true);
    for (const name of ['Invoice.Paid', '.paid', 'has space', '', 'x'.repeat(129), 'a/b'])
      expect(createEventTypeRequestSchema.safeParse({ name }).success, name).toBe(false);
  });

  it('cap the size of the payload schema', () => {
    const huge = { description: 'x'.repeat(70 * 1024) };
    expect(createEventTypeRequestSchema.safeParse({ name: 'a', schema: huge }).success).toBe(false);
  });
});

describe('endpoints', () => {
  const base = { url: 'https://example.com/hooks' };

  it('default to enabled, no headers and every event type', () => {
    expect(createEndpointRequestSchema.parse(base)).toMatchObject({
      enabled: true,
      headers: {},
      eventTypeIds: [],
    });
  });

  it('reject headers that Solmira controls, bad names and control characters', () => {
    const parse = (headers: Record<string, string>) =>
      createEndpointRequestSchema.safeParse({ ...base, headers });
    for (const name of [
      'host',
      'content-type',
      'webhook-id',
      'proxy-authorization',
      'x-forwarded-for',
    ])
      expect(parse({ [name]: 'x' }).success, name).toBe(false);
    expect(parse({ 'X-Upper': 'x' }).success).toBe(false);
    expect(parse({ 'x-token': 'a\r\nb: c' }).success).toBe(false);
    expect(parse({ authorization: 'Bearer abc', 'x-tenant': 'acme' }).success).toBe(true);
  });

  it('allow at most ten custom headers', () => {
    const headers = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`x-h${i}`, 'v']));
    expect(issues(createEndpointRequestSchema.safeParse({ ...base, headers }))).toContain(
      'At most 10 custom headers',
    );
  });

  it('bound the rate limit and let updates clear it', () => {
    expect(createEndpointRequestSchema.safeParse({ ...base, rateLimitPerSecond: 0 }).success).toBe(
      false,
    );
    expect(
      createEndpointRequestSchema.safeParse({ ...base, rateLimitPerSecond: 1001 }).success,
    ).toBe(false);
    expect(updateEndpointRequestSchema.safeParse({ rateLimitPerSecond: null }).success).toBe(true);
  });
});

describe('API keys', () => {
  it('default to the write scope and reject unknown scopes and past expiries', () => {
    expect(createApiKeyRequestSchema.parse({ name: 'ci' }).scopes).toEqual(['messages:write']);
    expect(createApiKeyRequestSchema.safeParse({ name: 'ci', scopes: ['admin'] }).success).toBe(
      false,
    );
    expect(createApiKeyRequestSchema.safeParse({ name: 'ci', scopes: [] }).success).toBe(false);
    expect(
      createApiKeyRequestSchema.safeParse({ name: 'ci', expiresAt: '2020-01-01T00:00:00Z' })
        .success,
    ).toBe(false);
  });
});
