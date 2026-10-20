import { isIP, type LookupFunction } from 'node:net';
import {
  EndpointUrlError,
  checkEndpointUrl,
  isPublicAddress,
  type AddressResolver,
} from '@solmira/service-kit';
import { Agent, request } from 'undici';

export type ErrorClass =
  | 'ssrf_blocked'
  | 'dns'
  | 'connect'
  | 'tls'
  | 'timeout'
  | 'redirect'
  | 'http_4xx'
  | 'http_5xx'
  | 'http_other'
  | 'network';

export interface SenderOptions {
  readonly connectTimeoutMs: number;
  readonly timeoutMs: number;
  readonly responseBodyLimitBytes: number;
  readonly production: boolean;
  /** Development and tests only: allows http and non-public addresses. */
  readonly allowPrivateTargets: boolean;
  readonly resolve: AddressResolver;
}

export interface SendRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface SendResult {
  /** True for a 2xx response. */
  readonly ok: boolean;
  readonly statusCode: number | null;
  readonly errorClass: ErrorClass | null;
  readonly durationMs: number;
  /** At most `responseBodyLimitBytes` of the response, decoded as UTF-8; the rest is never read. */
  readonly responseBody: string | null;
  readonly responseBodyTruncated: boolean;
}

/** Thrown from the connection's own name lookup, so a refused address never opens a socket. */
class BlockedTarget extends Error {
  constructor(readonly errorClass: 'ssrf_blocked' | 'dns') {
    super(errorClass);
  }
}

const TLS_CODES = /^(CERT_|DEPTH_ZERO|ERR_TLS|ERR_SSL|SELF_SIGNED|UNABLE_TO_|HOSTNAME_MISMATCH)/;
const CONNECT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ABORT_ERR']);
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA']);

function codeOf(error: unknown): string {
  const direct = (error as { code?: unknown } | null)?.code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause ? codeOf(cause) : '';
}

function blockedTargetOf(error: unknown): BlockedTarget | undefined {
  if (error instanceof BlockedTarget) return error;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause ? blockedTargetOf(cause) : undefined;
}

/** Maps a failure of the request itself to a class the tenant and the retry logic can use. */
export function classifyError(error: unknown): ErrorClass {
  const blocked = blockedTargetOf(error);
  if (blocked) return blocked.errorClass;
  const name = (error as { name?: string } | null)?.name;
  const code = codeOf(error);
  if (name === 'TimeoutError' || name === 'AbortError' || TIMEOUT_CODES.has(code)) return 'timeout';
  if (DNS_CODES.has(code)) return 'dns';
  if (TLS_CODES.test(code)) return 'tls';
  if (CONNECT_CODES.has(code)) return 'connect';
  return 'network';
}

function classifyStatus(statusCode: number): ErrorClass | null {
  if (statusCode >= 200 && statusCode < 300) return null;
  if (statusCode >= 300 && statusCode < 400) return 'redirect';
  if (statusCode >= 400 && statusCode < 500) return 'http_4xx';
  if (statusCode >= 500 && statusCode < 600) return 'http_5xx';
  return 'http_other';
}

/**
 * Sends one signed webhook (ADR-0031). The address check happens inside the connection's own name
 * lookup: the host is resolved once, every answer must be public, and that exact address is what
 * the socket connects to. There is no second resolution an attacker could answer differently, so
 * DNS rebinding has no window. Redirects are not followed; a 3xx is a failed delivery.
 */
export class HttpSender {
  private readonly agent: Agent;

  constructor(private readonly options: SenderOptions) {
    this.agent = new Agent({
      connections: 10, // per origin: also a first cap on how hard one receiver is hit
      connect: { timeout: options.connectTimeoutMs, lookup: this.pinnedLookup },
      headersTimeout: options.timeoutMs,
      bodyTimeout: options.timeoutMs,
    });
  }

  close(): Promise<void> {
    return this.agent.close();
  }

  async send(input: SendRequest): Promise<SendResult> {
    const started = Date.now();
    const finish = (partial: Omit<SendResult, 'durationMs'>): SendResult => ({
      ...partial,
      durationMs: Date.now() - started,
    });
    const failed = (errorClass: ErrorClass): SendResult =>
      finish({
        ok: false,
        statusCode: null,
        errorClass,
        responseBody: null,
        responseBodyTruncated: false,
      });

    try {
      checkEndpointUrl(input.url, {
        production: this.options.production,
        allowPrivateTargets: this.options.allowPrivateTargets,
      });
    } catch (error) {
      if (error instanceof EndpointUrlError) return failed('ssrf_blocked');
      throw error;
    }

    try {
      const response = await request(input.url, {
        method: 'POST',
        headers: input.headers,
        body: input.body,
        dispatcher: this.agent,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      const { text, truncated } = await readLimited(
        response.body,
        this.options.responseBodyLimitBytes,
      );
      const errorClass = classifyStatus(response.statusCode);
      return finish({
        ok: errorClass === null,
        statusCode: response.statusCode,
        errorClass,
        responseBody: text,
        responseBodyTruncated: truncated,
      });
    } catch (error) {
      return failed(classifyError(error));
    }
  }

  private pinnedLookup: LookupFunction = (hostname, options, callback) => {
    this.options
      .resolve(hostname)
      .then(
        (addresses) => {
          if (addresses.length === 0) throw new BlockedTarget('dns');
          if (!this.options.allowPrivateTargets && !addresses.every(isPublicAddress))
            throw new BlockedTarget('ssrf_blocked');
          const address = addresses[0] as string;
          const family = isIP(address);
          if (options.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
        () => {
          throw new BlockedTarget('dns');
        },
      )
      .catch((error: unknown) => callback(error as NodeJS.ErrnoException, '', 0));
  };
}

/** Reads at most `limit` bytes, then drops the connection instead of reading on. */
async function readLimited(
  body: AsyncIterable<Buffer> & { destroy(error?: Error): unknown },
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of body) {
    const room = limit - size;
    if (chunk.length > room) {
      if (room > 0) chunks.push(chunk.subarray(0, room));
      truncated = true;
      break;
    }
    chunks.push(chunk);
    size += chunk.length;
  }
  if (truncated) body.destroy();
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}
