import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule, platformOptionsFromEnv } from '@solmira/service-kit';
import { SERVICE_NAME, type OperationsConfig } from './config.js';

/**
 * Modular monolith root. Catalog, inventory, purchasing, orders and fulfillment arrive as
 * separate feature modules (phases 3-6) that share one database transaction boundary.
 */
@Module({})
export class AppModule {
  static register(config: OperationsConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(platformOptionsFromEnv(SERVICE_NAME, config))],
    };
  }
}
