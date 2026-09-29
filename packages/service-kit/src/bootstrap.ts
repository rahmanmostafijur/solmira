import { VersioningType, type DynamicModule, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './context/request-context.js';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';

export interface AppOptions {
  readonly serviceName: string;
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly docs?: { readonly title: string; readonly description: string };
}

export interface BootstrapOptions extends AppOptions {
  readonly port: number;
}

const JSON_BODY_LIMIT = '1mb';
const HEALTH_ROUTES = ['health/live', 'health/ready'];
const DOCS_PATH = 'docs';

/** Builds a fully configured (not yet listening) application. Tests use this directly. */
export async function createServiceApp(
  rootModule: DynamicModule | Type,
  options: AppOptions,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  app.use(requestContextMiddleware);
  app.use(securityHeaders());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Services only receive traffic from the gateway / load balancer on private networks.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.setGlobalPrefix('api', { exclude: HEALTH_ROUTES });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (options.docs && options.nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle(options.docs.title)
      .setDescription(options.docs.description)
      .setVersion('1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(DOCS_PATH, app, () => SwaggerModule.createDocument(app, config));
  }
  return app;
}

export async function bootstrapService(
  rootModule: DynamicModule | Type,
  options: BootstrapOptions,
): Promise<NestExpressApplication> {
  const app = await createServiceApp(rootModule, options);
  await app.listen(options.port, '0.0.0.0');
  app.get(Logger).log(`${options.serviceName} listening on port ${options.port}`, 'Bootstrap');
  return app;
}

/** JSON APIs get a locked-down CSP; the Swagger UI (non-production only) needs inline assets. */
function securityHeaders() {
  const apiHelmet = helmet({
    frameguard: { action: 'deny' },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  });
  const docsHelmet = helmet({ contentSecurityPolicy: false });
  return (req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith(`/${DOCS_PATH}`) ? docsHelmet : apiHelmet)(req, res, next);
}
