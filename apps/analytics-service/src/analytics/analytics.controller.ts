import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  analyticsRangeQuerySchema,
  type AnalyticsRangeQuery,
  type ApplicationReport,
  type ApplicationsReport,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  uuidParam,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { AnalyticsService } from './analytics.service.js';
import { resolveRange } from './range.js';

const rangePipe = new ZodValidationPipe(analyticsRangeQuerySchema);

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  /** Success rate, attempts per delivery and latency percentiles, one row per application. */
  @Get('applications')
  @RequirePermission('analytics.read')
  applications(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(rangePipe) query: AnalyticsRangeQuery,
  ): Promise<ApplicationsReport> {
    return this.analytics.applications(auth, resolveRange(query));
  }

  /** The same figures for one application as a whole and for each of its endpoints. */
  @Get('applications/:applicationId')
  @RequirePermission('analytics.read')
  application(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Query(rangePipe) query: AnalyticsRangeQuery,
  ): Promise<ApplicationReport> {
    return this.analytics.application(auth, applicationId, resolveRange(query));
  }
}
