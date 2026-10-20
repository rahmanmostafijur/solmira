import { afterEach, describe, expect, it } from 'vitest';
import { HttpSender, type SenderOptions } from './http-sender.js';
import { startServer, type TestServer } from '../../test/support/test-server.js';

const baseOptions: SenderOptions = {
  connectTimeoutMs: 500,
  timeoutMs: 1_000,
  responseBodyLimitBytes: 1024,
  production: false,
  allowPrivateTargets: true,
  resolve: async () => ['127.0.0.1'],
};

const post = (sender: HttpSender, url: string, body = '{"a":1}') =>
  sender.send({ url, headers: { 'content-type': 'application/json', 'x-test': 'yes' }, body });

describe('HttpSender', () => {
  const servers: TestServer[] = [];
  const senders: HttpSender[] = [];
  const serve = async (handler: Parameters<typeof startServer>[0]) => {
    const server = await startServer(handler);
    servers.push(server);
    return server;
  };
  const senderWith = (overrides: Partial<SenderOptions> = {}) => {
    const sender = new HttpSender({ ...baseOptions, ...overrides });
    senders.push(sender);
    return sender;
  };

  afterEach(async () => {
    await Promise.all(senders.splice(0).map((sender) => sender.close()));
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('delivers the body and headers and reports a 2xx as success', async () => {
    const server = await serve((_request, response) => response.writeHead(200).end('thanks'));
    const result = await post(senderWith(), 'http://hooks.test:' + server.port + '/in?x=1');
    expect(result).toMatchObject({
      ok: true,
      statusCode: 200,
      errorClass: null,
      responseBody: 'thanks',
      responseBodyTruncated: false,
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.body).toBe('{"a":1}');
    expect(server.requests[0]?.headers['x-test']).toBe('yes');
    expect(server.requests[0]?.headers.host).toBe('hooks.test:' + server.port);
  });

  it('classifies other statuses without treating them as success', async () => {
    for (const [status, errorClass] of [
      [204, null],
      [301, 'redirect'],
      [404, 'http_4xx'],
      [429, 'http_4xx'],
      [500, 'http_5xx'],
      [503, 'http_5xx'],
    ] as const) {
      const server = await serve((_request, response) => response.writeHead(status).end());
      const result = await post(senderWith(), 'http://hooks.test:' + server.port);
      expect({ status, ok: result.ok, errorClass: result.errorClass }).toEqual({
        status,
        ok: status === 204,
        errorClass,
      });
    }
  });

  it('does not follow a redirect', async () => {
    const target = await serve((_request, response) => response.writeHead(200).end());
    const redirector = await serve((_request, response) =>
      response.writeHead(302, { location: 'http://hooks.test:' + target.port + '/secret' }).end(),
    );
    const result = await post(senderWith(), 'http://hooks.test:' + redirector.port);
    expect(result).toMatchObject({ ok: false, statusCode: 302, errorClass: 'redirect' });
    expect(target.requests).toHaveLength(0);
  });

  it('connects to the address its own lookup returned, whatever the URL host says', async () => {
    const server = await serve((_request, response) => response.writeHead(200).end());
    const lookups: string[] = [];
    const sender = senderWith({ resolve: async (host) => (lookups.push(host), ['127.0.0.1']) });
    expect((await post(sender, 'http://anything.example:' + server.port)).ok).toBe(true);
    expect(lookups).toEqual(['anything.example']);
  });

  it('reports a refused connection as a connection failure', async () => {
    const server = await serve((_request, response) => response.end());
    const port = server.port;
    await server.close();
    servers.pop();
    const result = await post(senderWith(), 'http://hooks.test:' + port);
    expect(result).toMatchObject({ ok: false, errorClass: 'connect', statusCode: null });
  });
});
