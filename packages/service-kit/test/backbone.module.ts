import { Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { EventConsumerHost, EventConsumersModule } from '../src/messaging/event-consumer-host.js';
import type { EventConsumerDefinition } from '../src/messaging/event-consumer.js';
import { OutboxRelayModule } from '../src/messaging/outbox-relay.service.js';
import { PlatformModule, type PlatformOptions } from '../src/platform.module.js';

const DEFINITIONS = Symbol('DEFINITIONS');

class ConsumerRegistrar implements OnModuleInit {
  static readonly inject = [EventConsumerHost, DEFINITIONS];
  constructor(
    private readonly host: EventConsumerHost,
    private readonly definitions: readonly EventConsumerDefinition[],
  ) {}

  onModuleInit(): void {
    for (const definition of this.definitions) this.host.register(definition);
  }
}

/** The event backbone wired like a service would: consumers first, then the relay. */
@Module({})
export class BackboneProbeModule {
  static register(
    platform: PlatformOptions,
    definitions: readonly EventConsumerDefinition[],
    relay: { batchSize: number; pollIntervalMs: number } | null,
  ): DynamicModule {
    return {
      module: BackboneProbeModule,
      imports: [
        PlatformModule.forRoot(platform),
        EventConsumersModule.forRoot(),
        ...(relay ? [OutboxRelayModule.forRoot(relay)] : []),
      ],
      providers: [
        { provide: DEFINITIONS, useValue: definitions },
        {
          provide: ConsumerRegistrar,
          useFactory: (host: EventConsumerHost, defs: readonly EventConsumerDefinition[]) =>
            new ConsumerRegistrar(host, defs),
          inject: ConsumerRegistrar.inject,
        },
      ],
    };
  }
}
