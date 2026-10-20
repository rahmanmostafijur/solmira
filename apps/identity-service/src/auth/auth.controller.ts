import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  switchOrganizationRequestSchema,
  tokenRequestSchema,
  type AuthSession,
  type LoginRequest,
  type RegisterRequest,
} from '@solmira/contracts';
import {
  CurrentAuth,
  Public,
  UnauthenticatedError,
  ZodValidationPipe,
  type AuthContext,
  ApiZodBody,
} from '@solmira/service-kit';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { IdentityConfig } from '../config.js';
import { IDENTITY_CONFIG } from '../identity.tokens.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import {
  assertFirstPartyClient,
  clearAuthCookies,
  clientMetadata,
  readRefreshCookie,
  setAuthCookies,
} from './auth-cookies.js';
import { AuthService } from './auth.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccountRecoveryService) private readonly recovery: AccountRecoveryService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create an account and start a session' })
  @ApiZodBody(registerRequestSchema)
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    const result = await this.auth.register(body, clientMetadata(request));
    setAuthCookies(response, result.refresh, this.config.COOKIE_SECURE);
    return result.session;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in; the refresh token is set as an httpOnly cookie' })
  @ApiZodBody(loginRequestSchema)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    const result = await this.auth.login(body, clientMetadata(request));
    setAuthCookies(response, result.refresh, this.config.COOKIE_SECURE);
    return result.session;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh cookie and issue a new access token' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    assertFirstPartyClient(request);
    const presented = readRefreshCookie(request);
    try {
      if (!presented) throw new UnauthenticatedError('No active session');
      const result = await this.auth.refresh(presented);
      setAuthCookies(response, result.refresh, this.config.COOKIE_SECURE);
      return result.session;
    } catch (error) {
      clearAuthCookies(response, this.config.COOKIE_SECURE);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End the current session (idempotent)' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    assertFirstPartyClient(request);
    await this.auth.logout(readRefreshCookie(request));
    clearAuthCookies(response, this.config.COOKIE_SECURE);
  }

  @ApiBearerAuth()
  @Post('switch-organization')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue an access token for another organization the user belongs to' })
  @ApiZodBody(switchOrganizationRequestSchema)
  switchOrganization(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(switchOrganizationRequestSchema))
    body: z.infer<typeof switchOrganizationRequestSchema>,
  ): Promise<AuthSession> {
    return this.auth.switchOrganization(auth, body.organizationId);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiZodBody(tokenRequestSchema)
  async verifyEmail(
    @Body(new ZodValidationPipe(tokenRequestSchema)) body: z.infer<typeof tokenRequestSchema>,
  ): Promise<void> {
    await this.recovery.verifyEmail(body.token);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Email a reset link if the account exists (always 202)' })
  @ApiZodBody(forgotPasswordRequestSchema)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema))
    body: z.infer<typeof forgotPasswordRequestSchema>,
  ): Promise<void> {
    await this.recovery.requestPasswordReset(body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with a reset link; ends every session' })
  @ApiZodBody(resetPasswordRequestSchema)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema))
    body: z.infer<typeof resetPasswordRequestSchema>,
  ): Promise<void> {
    await this.recovery.resetPassword(body.token, body.password);
  }
}
