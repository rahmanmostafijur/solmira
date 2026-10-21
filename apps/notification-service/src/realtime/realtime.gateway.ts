import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  REALTIME_AUTH_TIMEOUT_MS,
  REALTIME_CLOSE,
  REALTIME_PATH,
  hasPermissions,
  realtimeClientFrameSchema,
  type RealtimeServerFrame,
} from '@solmira/contracts';
import {
  AccessTokenVerifier,
  REVOCATION_STORE,
  toAuthContext,
  type RevocationStore,
} from '@solmira/service-kit';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { RealtimeHub, type FeedConnection } from './realtime.hub.js';

const HEARTBEAT_MS = 30_000;
/** Clients send one small auth frame and nothing else. */
const MAX_FRAME_BYTES = 4 * 1024;

type Tracked = WebSocket & { isAlive?: boolean };
interface Session {
  release: () => void;
}

/**
 * The WebSocket endpoint of the delivery feed (ADR-0035). A connection is anonymous until its first
 * frame carries an access token that verifies, is not revoked, belongs to an organization and grants
 * `messages.read`. Browsers cannot set headers on a WebSocket, and a token in the URL would end up
 * in logs, so the token travels in the first frame. No cookie is involved, so a page on another
 * origin cannot ride on a user's session. The connection closes when the token expires; the client
 * reconnects with a fresh one.
 */
@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('RealtimeGateway');
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
    @Inject(AccessTokenVerifier) private readonly verifier: AccessTokenVerifier,
    @Inject(REVOCATION_STORE) private readonly revocations: RevocationStore,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapter.httpAdapter.getHttpServer() as Server;
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path !== REALTIME_PATH) return socket.destroy();
      this.sockets.handleUpgrade(request, socket, head, (client) => this.accept(client));
    });
    this.heartbeat = setInterval(() => this.checkAlive(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.heartbeat);
    this.hub.closeAll(1001, 'Server restarting');
    this.sockets.close();
  }

  private accept(socket: Tracked): void {
    socket.isAlive = true;
    socket.on('pong', () => (socket.isAlive = true));
    socket.on('error', () => socket.terminate());
    const authTimer = setTimeout(
      () => socket.close(REALTIME_CLOSE.unauthenticated, 'Authentication timed out'),
      REALTIME_AUTH_TIMEOUT_MS,
    );
    let session: Session | undefined;

    socket.once('message', (raw) => {
      clearTimeout(authTimer);
      // Anything after the auth frame is a protocol violation: this feed is one-way.
      socket.on('message', () => socket.close(REALTIME_CLOSE.protocolError, 'Unexpected frame'));
      void this.authenticate(socket, raw.toString('utf8')).then((opened) => {
        session = opened;
        // The client may have left while its token was being checked.
        if (socket.readyState !== WebSocket.OPEN) opened?.release();
      });
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      session?.release();
    });
  }

  /** Returns the open session, or undefined after closing the socket with the reason. */
  private async authenticate(socket: WebSocket, text: string): Promise<Session | undefined> {
    let token: string;
    try {
      token = realtimeClientFrameSchema.parse(JSON.parse(text)).token;
    } catch {
      socket.close(REALTIME_CLOSE.protocolError, 'Expected an auth frame');
      return undefined;
    }
    try {
      const claims = await this.verifier.verify(token);
      if (await this.revocations.isRevoked(claims)) throw new Error('revoked');
      const auth = toAuthContext(claims);
      if (!auth.organizationId) {
        socket.close(REALTIME_CLOSE.forbidden, 'Select an organization');
        return undefined;
      }
      if (!hasPermissions(auth.permissions, ['messages.read'])) {
        socket.close(REALTIME_CLOSE.forbidden, 'Not allowed to see deliveries');
        return undefined;
      }
      if (socket.readyState !== WebSocket.OPEN) return undefined;
      return this.open(socket, auth.organizationId, claims.exp);
    } catch (error) {
      this.logger.debug({ err: error }, 'Realtime authentication failed');
      socket.close(REALTIME_CLOSE.unauthenticated, 'Invalid or expired token');
      return undefined;
    }
  }

  private open(
    socket: WebSocket,
    organizationId: string,
    expiresAtSeconds: number,
  ): Session | undefined {
    const connection: FeedConnection = {
      send: (frame) => socket.send(frame, (error) => error && socket.terminate()),
      bufferedBytes: () => socket.bufferedAmount,
      close: (code, reason) => socket.close(code, reason),
    };
    if (!this.hub.add(organizationId, connection)) {
      socket.close(REALTIME_CLOSE.tooSlow, 'Too many connections for this organization');
      return undefined;
    }
    const expiry = setTimeout(
      () => socket.close(REALTIME_CLOSE.unauthenticated, 'Token expired'),
      Math.max(0, expiresAtSeconds * 1000 - Date.now()),
    );
    const ready: RealtimeServerFrame = { type: 'ready', organizationId };
    socket.send(JSON.stringify(ready));
    return {
      release: () => {
        clearTimeout(expiry);
        this.hub.remove(organizationId, connection);
      },
    };
  }

  private checkAlive(): void {
    for (const socket of this.sockets.clients as Set<Tracked>) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }
}
