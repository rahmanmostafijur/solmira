import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpMemberLookup } from './member-lookup.js';

const ORG = '0192a3b4-0000-7000-8000-00000000000a';
const MEMBER = '0192a3b4-0000-7000-8000-0000000000aa';

describe('HttpMemberLookup (token relay to identity-service)', () => {
  let server: Server;
  let baseUrl: string;
  let lastHeaders: IncomingHttpHeaders = {};

  beforeAll(async () => {
    server = createServer((request, response) => {
      lastHeaders = request.headers;
      if (request.url === `/api/v1/organizations/${ORG}/members/${MEMBER}`) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            id: MEMBER,
            userId: 'u-1',
            fullName: 'Rahim Uddin',
            email: 'rahim@example.test',
            status: 'active',
            role: 'MANAGER',
          }),
        );
      } else if (request.url?.includes('forbidden')) {
        response.writeHead(403).end();
      } else if (request.url?.includes('broken')) {
        response.writeHead(500).end();
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("forwards the caller's own token and maps the member", async () => {
    const member = await new HttpMemberLookup(baseUrl).find(ORG, MEMBER, 'caller-token');

    expect(lastHeaders.authorization).toBe('Bearer caller-token');
    expect(member).toEqual({
      memberId: MEMBER,
      userId: 'u-1',
      fullName: 'Rahim Uddin',
      email: 'rahim@example.test',
      status: 'active',
    });
  });

  it('treats 404 (including another tenant’s member) as not found', async () => {
    await expect(new HttpMemberLookup(baseUrl).find(ORG, 'someone-else', 't')).resolves.toBeNull();
  });

  it('maps 403 to a permission error and failures to 503', async () => {
    await expect(
      new HttpMemberLookup(baseUrl).find('forbidden', MEMBER, 't'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(new HttpMemberLookup(baseUrl).find('broken', MEMBER, 't')).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      new HttpMemberLookup('http://127.0.0.1:1').find(ORG, MEMBER, 't'),
    ).rejects.toMatchObject({ status: 503 });
  });
});
