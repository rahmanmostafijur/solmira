import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule, platformOptionsFromEnv } from '@solmira/service-kit';
import { SERVICE_NAME, type DispatcherConfig } from './config.js';
import { DispatcherModule, type DispatcherAdapters } from './dispatcher.module.js';

/** A worker: its only inbound surface is the health endpoints from the platform module. */
@Module({})
export class AppModule {
  static register(config: DispatcherConfig, adapters: DispatcherAdapters = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(platformOptionsFromEnv(SERVICE_NAME, config)),
        DispatcherModule.register(config, adapters),
      ],
    };
  }
}
