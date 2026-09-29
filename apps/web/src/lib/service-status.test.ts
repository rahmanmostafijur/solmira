import { SERVICES } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { fetchServiceStatuses, toServiceStatus } from './service-status';

const identity = SERVICES[0];

describe('toServiceStatus', () => {
  it('is ready when every dependency check passes', () => {
    const status = toServiceStatus(identity, {
      status: 'ok',
      service: 'identity-service',
      checks: [{ name: 'postgres', status: 'ok', latencyMs: 3 }],
    });

    expect(status).toMatchObject({ key: 'identity', state: 'ready' });
    expect(status.checks).toHaveLength(1);
  });

  it('is degraded when the service answers but a dependency is down', () => {
    const status = toServiceStatus(identity, {
      status: 'error',
      service: 'identity-service',
      checks: [{ name: 'redis', status: 'error', latencyMs: 2000 }],
    });

    expect(status.state).toBe('degraded');
  });

  it('is unreachable when the gateway answers instead of the service', () => {
    const gatewayEnvelope = {
      error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable' },
    };

    expect(toServiceStatus(identity, gatewayEnvelope)).toMatchObject({
      state: 'unreachable',
      checks: [],
    });
  });
});

describe('fetchServiceStatuses', () => {
  it('probes every service through the gateway and isolates failures', async () => {
    const requested: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith('/audit')) throw new TypeError('fetch failed');
      return Response.json({ status: 'ok', service: 'x', checks: [] });
    }) as typeof fetch;

    const statuses = await fetchServiceStatuses('http://gateway', fakeFetch);

    expect(requested).toHaveLength(SERVICES.length);
    expect(requested[0]).toBe('http://gateway/internal/health/identity');
    expect(statuses.find((s) => s.key === 'audit')?.state).toBe('unreachable');
    expect(statuses.filter((s) => s.state === 'ready')).toHaveLength(SERVICES.length - 1);
  });
});
