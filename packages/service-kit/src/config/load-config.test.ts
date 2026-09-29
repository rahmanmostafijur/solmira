import { describe, expect, it } from 'vitest';
import { baseEnvSchema, portSchema, postgresEnvSchema } from './env.js';
import { ConfigValidationError, loadConfig } from './load-config.js';

const schema = baseEnvSchema.extend({ PORT: portSchema(4001) }).extend(postgresEnvSchema.shape);

describe('loadConfig', () => {
  it('applies defaults and coerces types', () => {
    const config = loadConfig(schema, { DATABASE_URL: 'postgres://u:p@localhost:5432/db' });

    expect(config).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      PORT: 4001,
      DATABASE_POOL_MAX: 10,
    });
  });

  it('parses boolean-like strings', () => {
    const config = loadConfig(schema, { DATABASE_URL: 'postgres://h/db', LOG_PRETTY: 'true' });

    expect(config.LOG_PRETTY).toBe(true);
  });

  it('returns a frozen object', () => {
    const config = loadConfig(schema, { DATABASE_URL: 'postgres://h/db' });

    expect(Object.isFrozen(config)).toBe(true);
  });

  it('reports every invalid variable by name', () => {
    const act = () => loadConfig(schema, { PORT: 'not-a-port', LOG_LEVEL: 'loud' });

    expect(act).toThrow(ConfigValidationError);
    try {
      act();
    } catch (error) {
      const paths = (error as ConfigValidationError).issues.map((issue) => issue.split(':')[0]);
      expect(paths).toEqual(expect.arrayContaining(['PORT', 'LOG_LEVEL', 'DATABASE_URL']));
    }
  });

  it('never echoes the rejected value, so secrets cannot leak into logs', () => {
    const secretish = 'mysql://admin:SuperSecretPassword@db/prod';

    expect(() => loadConfig(schema, { DATABASE_URL: secretish })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('SuperSecretPassword') }),
    );
  });

  it('rejects URLs with the wrong protocol', () => {
    expect(() => loadConfig(schema, { DATABASE_URL: 'http://localhost:5432/db' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
