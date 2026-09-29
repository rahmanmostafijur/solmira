import { Module, type DynamicModule } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthRegistry } from './health.registry.js';

@Module({})
export class HealthModule {
  static forRoot(serviceName: string): DynamicModule {
    return {
      module: HealthModule,
      global: true,
      controllers: [HealthController],
      providers: [{ provide: HealthRegistry, useFactory: () => new HealthRegistry(serviceName) }],
      exports: [HealthRegistry],
    };
  }
}
