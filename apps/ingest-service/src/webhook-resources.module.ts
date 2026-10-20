import { Module } from '@nestjs/common';
import { ApiKeyAuthenticator } from './api-keys/api-key-authenticator.js';
import { ApiKeysController } from './api-keys/api-keys.controller.js';
import { ApiKeysService } from './api-keys/api-keys.service.js';
import { ApplicationsController } from './applications/applications.controller.js';
import { ApplicationsService } from './applications/applications.service.js';
import { EndpointSecretsService } from './endpoints/endpoint-secrets.service.js';
import { EndpointUrlValidator } from './endpoints/endpoint-url-validator.js';
import { EndpointsController } from './endpoints/endpoints.controller.js';
import { EndpointsService } from './endpoints/endpoints.service.js';
import { EventTypesController } from './event-types/event-types.controller.js';
import { EventTypesService } from './event-types/event-types.service.js';

/** Applications, event types, endpoints with their signing secrets, and API keys (Phase 4). */
@Module({
  controllers: [
    ApplicationsController,
    EventTypesController,
    EndpointsController,
    ApiKeysController,
  ],
  providers: [
    ApplicationsService,
    EventTypesService,
    EndpointUrlValidator,
    EndpointsService,
    EndpointSecretsService,
    ApiKeysService,
    ApiKeyAuthenticator,
  ],
  exports: [ApiKeyAuthenticator],
})
export class WebhookResourcesModule {}
