import { Inject, Injectable, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { HealthRegistry } from '@solmira/service-kit';
import type { OperationsConfig } from './config.js';
import { HttpMemberLookup, type MemberLookup } from './members/member-lookup.js';
import { MEMBER_LOOKUP, OBJECT_STORAGE, OPERATIONS_CONFIG } from './operations.tokens.js';
import { S3ObjectStorage, type ObjectStorage } from './storage/object-storage.js';

export interface OperationsAdapters {
  readonly memberLookup?: MemberLookup;
  readonly objectStorage?: ObjectStorage;
}

@Injectable()
class StorageHealth implements OnModuleInit {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
  ) {}

  onModuleInit(): void {
    // Non-critical: without storage only images fail (503); catalog CRUD keeps serving.
    this.health.register('object-storage', () => this.storage.ping(), { critical: false });
  }
}

/** Configuration and outbound adapters (object storage, identity member lookups). */
@Module({})
export class OperationsCoreModule {
  static register(config: OperationsConfig, adapters: OperationsAdapters = {}): DynamicModule {
    return {
      module: OperationsCoreModule,
      global: true,
      providers: [
        { provide: OPERATIONS_CONFIG, useValue: config },
        {
          provide: OBJECT_STORAGE,
          useValue: adapters.objectStorage ?? new S3ObjectStorage(config),
        },
        {
          provide: MEMBER_LOOKUP,
          useValue: adapters.memberLookup ?? new HttpMemberLookup(config.IDENTITY_INTERNAL_URL),
        },
        StorageHealth,
      ],
      exports: [OPERATIONS_CONFIG, OBJECT_STORAGE, MEMBER_LOOKUP],
    };
  }
}
