import { afterEach, describe, expect, it } from 'vitest';
import { HttpSender, classifyError, type SenderOptions } from './http-sender.js';
import { startServer, type TestServer } from '../../test/support/test-server.js';

const baseOptions: SenderOptions = {
  connectTimeoutMs: 500,
  timeoutMs: 1_000,
  responseBodyLimitBytes: 1024,
  production: false,
  allowPrivateTargets: true,
  resolve: async () => ['127.0.0.1'],
};

describe('HttpSender limits', () => {
  const servers: TestServer[] = [];
  const senders: HttpSender[] = [];
  const serve = async (handler: Parameters<typeof startServer>[0]) => {
    const server = await startServer(handler);
    servers.push(server);
    return server;
  };
  const post = (overrides: Partial<SenderOptions>, port: number) => {
    const sender = new HttpSender({ ...baseOptions, ...overrides });
    senders.push(sender);
    return sender.send({ url: 'http://hooks.test:' + port, headers: {}, body: '{}' });
  };

  afterEach(async () => {
    await Promise.all(senders.splice(0).map((sender) => sender.close()));
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('gives up on a receiver that never answers, within the total timeout', async () => {
    const server = await serve(() => undefined);
    const started = Date.now();
    const result = await post({ timeoutMs: 400 }, server.port);
    expect(result).toMatchObject({ ok: false, errorClass: 'timeout', statusCode: null });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('gives up on a receiver that drips its answer forever', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200);
      const timer = setInterval(() => response.write('.'), 20);
      response.on('close', () => clearInterval(timer));
    });
    const started = Date.now();
    const result = await post({ timeoutMs: 600, responseBodyLimitBytes: 100_000 }, server.port);
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(result.errorClass).toBe('timeout');
  });

  it('stops reading an endless response at the stored limit', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200);
      const chunk = 'x'.repeat(8192);
      const pump = () => {
        while (response.write(chunk)) {
          /* keep filling until the socket pushes back */
        }
        response.once('drain', pump);
      };
      pump();
    });
    const started = Date.now();
    const result = await post({ responseBodyLimitBytes: 256 }, server.port);
    expect(result).toMatchObject({ ok: true, statusCode: 200, responseBodyTruncated: true });
    expect(result.responseBody).toHaveLength(256);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('keeps only the first bytes of a large response', async () => {
    const server = await serve((_request, response) =>
      response.writeHead(500).end('e'.repeat(5_000_000)),
    );
    const result = await post({ responseBodyLimitBytes: 4096 }, server.port);
    expect(result).toMatchObject({
      ok: false,
      statusCode: 500,
      errorClass: 'http_5xx',
      responseBodyTruncated: true,
    });
    expect(result.responseBody).toHaveLength(4096);
  });
});

describe('classifyError', () => {
  const withCode = (code: string, name = 'Error') => Object.assign(new Error(code), { code, name });

  it('maps system and library error codes to classes', () => {
    expect(classifyError(withCode('ECONNREFUSED'))).toBe('connect');
    expect(classifyError(withCode('UND_ERR_CONNECT_TIMEOUT'))).toBe('connect');
    expect(classifyError(withCode('UND_ERR_HEADERS_TIMEOUT'))).toBe('timeout');
    expect(classifyError(withCode('UND_ERR_BODY_TIMEOUT'))).toBe('timeout');
    expect(classifyError(withCode('x', 'TimeoutError'))).toBe('timeout');
    expect(classifyError(withCode('x', 'AbortError'))).toBe('timeout');
    expect(classifyError(withCode('ENOTFOUND'))).toBe('dns');
    expect(classifyError(withCode('DEPTH_ZERO_SELF_SIGNED_CERT'))).toBe('tls');
    expect(classifyError(withCode('CERT_HAS_EXPIRED'))).toBe('tls');
    expect(classifyError(new Error('who knows'))).toBe('network');
  });

  it('looks through wrapped errors', () => {
    const inner = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    expect(classifyError(new TypeError('fetch failed', { cause: inner }))).toBe('connect');
  });
});
