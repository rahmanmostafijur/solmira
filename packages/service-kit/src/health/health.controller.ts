import { Controller, Get, HttpStatus, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ReadinessReport } from '@solmira/contracts';
import type { Response } from 'express';
import { HealthRegistry } from './health.registry.js';

/**
 * Liveness answers "should this process be restarted?" and never touches dependencies,
 * otherwise a database blip would make the orchestrator kill healthy containers.
 * Readiness answers "should this instance receive traffic?".
 */
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Inject(HealthRegistry) private readonly registry: HealthRegistry) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await this.registry.readiness();
    res.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
