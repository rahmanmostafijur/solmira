import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServer {
  readonly port: number;
  /** Every request the server received, in order. */
  readonly requests: { headers: IncomingMessage['headers']; body: string }[];
  close(): Promise<void>;
}

/** A real HTTP server on the loopback interface for the sender and dispatcher tests. */
export async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<TestServer> {
  const requests: TestServer['requests'] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      handler(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
