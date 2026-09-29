import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@solmira/service-kit';
import { AccessTokenIssuer } from './access-token-issuer.js';

@ApiTags('auth')
@Controller('auth/.well-known')
export class JwksController {
  constructor(@Inject(AccessTokenIssuer) private readonly tokens: AccessTokenIssuer) {}

  /** Public verification keys for access tokens (RFC 7517). */
  @Public()
  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.tokens.jwks();
  }
}
