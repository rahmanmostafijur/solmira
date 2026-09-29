import { Module, type DynamicModule } from '@nestjs/common';
import type { IdentityConfig } from './config.js';
import { EMAIL_SENDER, IDENTITY_CONFIG } from './identity.tokens.js';
import type { EmailSender } from './mail/email-sender.js';

/** Validated configuration and outbound adapters, available to every identity module. */
@Module({})
export class IdentityCoreModule {
  static register(config: IdentityConfig, emailSender: EmailSender): DynamicModule {
    return {
      module: IdentityCoreModule,
      global: true,
      providers: [
        { provide: IDENTITY_CONFIG, useValue: config },
        { provide: EMAIL_SENDER, useValue: emailSender },
      ],
      exports: [IDENTITY_CONFIG, EMAIL_SENDER],
    };
  }
}
