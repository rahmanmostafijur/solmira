import { Module } from '@nestjs/common';
import { AccessContextService } from './access-context.service.js';
import { AccessTokenIssuer } from './access-token-issuer.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwksController } from './jwks.controller.js';
import { PasswordHasher } from './password-hasher.js';
import { PasswordController } from './password.controller.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  controllers: [AuthController, SessionsController, PasswordController, JwksController],
  providers: [
    AccessContextService,
    AccessTokenIssuer,
    AccountRecoveryService,
    AuthService,
    PasswordHasher,
    SessionsService,
  ],
  exports: [AccessContextService, AuthService, SessionsService],
})
export class IdentityAuthModule {}
