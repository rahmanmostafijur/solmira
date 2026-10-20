import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpSender, type SenderOptions } from './http-sender.js';
import { startServer, type TestServer } from '../../test/support/test-server.js';

/** Strict mode: what production runs with. Nothing here may ever reach the local server. */
describe('HttpSender target checks', () => {
  let server: TestServer;
  const senders: HttpSender[] = [];

  beforeAll(async () => {
    server = await startServer((_request, response) => response.writeHead(200).end());
  });
  afterAll(async () => {
    await Promise.all(senders.map((sender) => sender.close()));
    await server.close();
  });

  const post = (resolve: SenderOptions['resolve'], url: string) => {
    const sender = new HttpSender({
      connectTimeoutMs: 300,
      timeoutMs: 1_000,
      responseBodyLimitBytes: 1024,
      production: true,
      allowPrivateTargets: false,
      resolve,
    });
    senders.push(sender);
    return sender.send({ url, headers: {}, body: '{}' });
  };

  it('never connects to a literal private or loopback address', async () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]']) {
      const result = await post(async () => ['8.8.8.8'], 'https://' + host + ':' + server.port);
      expect(result).toMatchObject({ ok: false, errorClass: 'ssrf_blocked' });
    }
    expect(server.requests).toHaveLength(0);
  });

  it('refuses plain http in production mode', async () => {
    const result = await post(async () => ['8.8.8.8'], 'http://hooks.example.com:' + server.port);
    expect(result.errorClass).toBe('ssrf_blocked');
  });

  it('refuses a host name that resolves to a private address, or to a mix', async () => {
    for (const answers of [
      ['127.0.0.1'],
      ['10.1.2.3'],
      ['93.184.216.34', '127.0.0.1'],
      ['::1'],
      ['::ffff:127.0.0.1'],
    ]) {
      const result = await post(async () => answers, 'https://rebind.example.com:' + server.port);
      expect({ answers, errorClass: result.errorClass }).toEqual({
        answers,
        errorClass: 'ssrf_blocked',
      });
    }
    expect(server.requests).toHaveLength(0);
  });

  it('reports a host that does not resolve, or whose lookup fails, as a DNS failure', async () => {
    expect((await post(async () => [], 'https://nowhere.example.com')).errorClass).toBe('dns');
    const failing = async (): Promise<string[]> => {
      throw new Error('SERVFAIL');
    };
    expect((await post(failing, 'https://nowhere.example.com')).errorClass).toBe('dns');
  });

  it('resolves once and uses only that answer, so a rebinding answer is never reached', async () => {
    let calls = 0;
    const rebinding = async () => ((calls += 1) === 1 ? ['8.8.8.8'] : ['127.0.0.1']);
    // The first answer is public, so the sender tries 8.8.8.8 (unreachable here); the loopback
    // answer that a second lookup would have returned must never be used.
    const result = await post(rebinding, 'https://rebind.example.com:' + server.port);
    expect(result.ok).toBe(false);
    expect(['connect', 'timeout']).toContain(result.errorClass);
    expect(calls).toBe(1);
    expect(server.requests).toHaveLength(0);
  });
});
