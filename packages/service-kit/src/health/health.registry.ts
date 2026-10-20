import { Logger } from '@nestjs/common';
import type { DependencyCheck, ReadinessReport } from '@solmira/contracts';

export type HealthCheck = () => Promise<unknown>;

export const DEFAULT_CHECK_TIMEOUT_MS = 2_000;

/**
 * Infrastructure modules register a readiness probe here during init. Checks run in parallel and
 * are individually time-boxed, so one hung dependency cannot stall the whole readiness endpoint.
 */
export interface HealthCheckOptions {
  /**
   * Critical checks gate readiness. A non-critical dependency (e.g. a mail relay) is reported,
   * but its outage degrades one feature instead of pulling the instance
   * out of the load balancer.
   */
  readonly critical?: boolean;
}

interface RegisteredCheck {
  readonly check: HealthCheck;
  readonly critical: boolean;
}

export class HealthRegistry {
  private readonly checks = new Map<string, RegisteredCheck>();
  private readonly logger = new Logger(HealthRegistry.name);

  constructor(
    private readonly serviceName: string,
    private readonly timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
  ) {}

  register(name: string, check: HealthCheck, options: HealthCheckOptions = {}): void {
    if (this.checks.has(name)) {
      throw new Error(`Health check "${name}" is already registered`);
    }
    this.checks.set(name, { check, critical: options.critical ?? true });
  }

  async readiness(): Promise<ReadinessReport> {
    const results = await Promise.all(
      [...this.checks].map(([name, registered]) => this.runCheck(name, registered)),
    );
    return {
      status: results.every((result) => result.status === 'ok' || result.critical === false)
        ? 'ok'
        : 'error',
      service: this.serviceName,
      checks: results,
    };
  }

  private async runCheck(
    name: string,
    { check, critical }: RegisteredCheck,
  ): Promise<DependencyCheck> {
    const startedAt = performance.now();
    const flag = critical ? {} : { critical: false };
    try {
      await withTimeout(check(), this.timeoutMs);
      return { name, status: 'ok', latencyMs: elapsedSince(startedAt), ...flag };
    } catch (error) {
      this.logger.warn({ err: error, check: name }, 'Readiness check failed');
      return { name, status: 'error', latencyMs: elapsedSince(startedAt), ...flag };
    }
  }
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
