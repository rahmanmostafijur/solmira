import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule, platformOptionsFromEnv } from '@solmira/service-kit';
import { SERVICE_NAME, type IdentityConfig } from './config.js';

@Module({})
export class AppModule {
  static register(config: IdentityConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(platformOptionsFromEnv(SERVICE_NAME, config))],
    };
  }
}
