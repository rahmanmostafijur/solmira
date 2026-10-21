import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { MetricsRegistry, type MetricsOptions } from './registry.js';

class MetricsStarter implements OnApplicationBootstrap {
  constructor(@Inject(MetricsRegistry) private readonly registry: MetricsRegistry) {}

  onApplicationBootstrap(): void {
    this.registry.start();
  }
}

/** Makes the registry available everywhere and starts its periodic flush with the application. */
@Global()
@Module({})
export class MetricsModule {
  static forRoot(options: MetricsOptions): DynamicModule {
    return {
      module: MetricsModule,
      providers: [
        { provide: MetricsRegistry, useFactory: () => new MetricsRegistry(options) },
        MetricsStarter,
      ],
      exports: [MetricsRegistry],
    };
  }
}
