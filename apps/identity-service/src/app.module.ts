import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule, PlatformModule, platformOptionsFromEnv } from '@solmira/service-kit';
import { IdentityAuthModule } from './auth/identity-auth.module.js';
import { SERVICE_NAME, type IdentityConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';
import { IdentityCoreModule } from './identity-core.module.js';
import { createEmailSender, type EmailSender } from './mail/email-sender.js';
import { OrganizationsModule } from './organizations/organizations.module.js';

/** Replaceable adapters at the service boundary (tests swap the SMTP sender for an in-memory one). */
export interface AppAdapters {
  readonly emailSender?: EmailSender;
}

@Module({})
export class AppModule {
  static register(config: IdentityConfig, adapters: AppAdapters = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(platformOptionsFromEnv(SERVICE_NAME, config)),
        AuthModule.forRoot({
          publicKeyPem: config.JWT_PUBLIC_KEY,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
        }),
        IdentityCoreModule.register(config, adapters.emailSender ?? createEmailSender(config)),
        DatabaseModule,
        IdentityAuthModule,
        OrganizationsModule,
      ],
    };
  }
}
