import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { REQUEST_ID_HEADER } from '@solmira/contracts';
import { getRequestContext } from '../context/request-context.js';

/** Redaction happens inside the logger so no call site can forget it. */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.apiKey',
];

export interface LoggerOptions {
  readonly serviceName: string;
  readonly level: string;
  readonly pretty: boolean;
}

interface SerializedRequest {
  method?: string;
  url?: string;
}

interface SerializedResponse {
  statusCode?: number;
}

export function createLoggerModule({ serviceName, level, pretty }: LoggerOptions): DynamicModule {
  return LoggerModule.forRoot({
    pinoHttp: {
      level,
      base: { service: serviceName },
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      // Adds request/correlation IDs to every log line, including ones written outside HTTP handlers
      // (message consumers run inside the same AsyncLocalStorage context).
      mixin: () => {
        const context = getRequestContext();
        return context
          ? { requestId: context.requestId, correlationId: context.correlationId }
          : {};
      },
      genReqId: (req) => String(req.headers[REQUEST_ID_HEADER] ?? ''),
      redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' },
      serializers: {
        // Query strings can carry tokens (password reset links, signed URLs), so log the path only.
        req: (req: SerializedRequest) => ({ method: req.method, path: req.url?.split('?')[0] }),
        res: (res: SerializedResponse) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
    },
  });
}
