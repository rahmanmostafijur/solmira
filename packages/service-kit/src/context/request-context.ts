import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '@solmira/contracts';

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** IDs are echoed into logs and headers, so only accept a conservative character set. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function acceptId(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== undefined && SAFE_ID_PATTERN.test(candidate) ? candidate : undefined;
}

export function resolveRequestContext(
  headers: IncomingHttpHeaders,
  generateId: () => string = randomUUID,
): RequestContext {
  const requestId = acceptId(headers[REQUEST_ID_HEADER]) ?? generateId();
  const correlationId = acceptId(headers[CORRELATION_ID_HEADER]) ?? requestId;
  return { requestId, correlationId };
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * First middleware in every service. Everything that runs later in the same async chain
 * (handlers, repositories, log calls, published events) can read the IDs without passing them around.
 */
export function requestContextMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
): void {
  const context = resolveRequestContext(req.headers);
  // Downstream middleware (pino-http) reads the headers, so replace unsafe values with the validated ones.
  req.headers[REQUEST_ID_HEADER] = context.requestId;
  req.headers[CORRELATION_ID_HEADER] = context.correlationId;
  res.setHeader('X-Request-Id', context.requestId);
  res.setHeader('X-Correlation-Id', context.correlationId);
  storage.run(context, () => next());
}
