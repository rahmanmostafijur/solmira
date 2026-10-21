import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { changePasswordRequestSchema, type ChangePasswordRequest } from '@solmira/contracts';
import { ApiZodBody, CurrentAuth, ZodValidationPipe, type AuthContext } from '@solmira/service-kit';
import { AuthService } from './auth.service.js';

@ApiTags('account')
@ApiBearerAuth()
@Controller('me')
export class PasswordController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change the password; signs out every other session' })
  @ApiZodBody(changePasswordRequestSchema)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.auth.changePassword(auth, body);
  }
}
