import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { HealthRegistry } from './health.registry.js';

describe('HealthRegistry', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('reports ok with no checks registered', async () => {
    const registry = new HealthRegistry('identity');

    expect(await registry.readiness()).toEqual({ status: 'ok', service: 'identity', checks: [] });
  });

  it('reports each check and an overall error when any check fails', async () => {
    const registry = new HealthRegistry('identity');
    registry.register('postgres', async () => undefined);
    registry.register('redis', async () => {
      throw new Error('ECONNREFUSED 10.0.0.12:6379');
    });

    const report = await registry.readiness();

    expect(report.status).toBe('error');
    expect(report.checks.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'postgres', status: 'ok' },
      { name: 'redis', status: 'error' },
    ]);
  });

  it('does not expose failure causes in the report', async () => {
    const registry = new HealthRegistry('identity');
    registry.register('redis', async () => {
      throw new Error('ECONNREFUSED 10.0.0.12:6379');
    });

    expect(JSON.stringify(await registry.readiness())).not.toContain('10.0.0.12');
  });

  it('fails checks that exceed the timeout', async () => {
    const registry = new HealthRegistry('identity', 20);
    registry.register('rabbitmq', () => new Promise(() => undefined));

    const report = await registry.readiness();

    expect(report.checks[0]).toMatchObject({ name: 'rabbitmq', status: 'error' });
    expect(report.checks[0]?.latencyMs).toBeGreaterThanOrEqual(15);
  });

  it('rejects duplicate check names', () => {
    const registry = new HealthRegistry('identity');
    registry.register('postgres', async () => undefined);

    expect(() => registry.register('postgres', async () => undefined)).toThrow(
      /already registered/,
    );
  });
});
