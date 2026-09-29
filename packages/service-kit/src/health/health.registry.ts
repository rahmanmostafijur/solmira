import { Logger } from '@nestjs/common';
import type { DependencyCheck, ReadinessReport } from '@solmira/contracts';

export type HealthCheck = () => Promise<unknown>;

export const DEFAULT_CHECK_TIMEOUT_MS = 2_000;

/**
 * Infrastructure modules register a readiness probe here during init. Checks run in parallel and
 * are individually time-boxed, so one hung dependency cannot stall the whole readiness endpoint.
 */
export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();
  private readonly logger = new Logger(HealthRegistry.name);

  constructor(
    private readonly serviceName: string,
    private readonly timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
  ) {}

  register(name: string, check: HealthCheck): void {
    if (this.checks.has(name)) {
      throw new Error(`Health check "${name}" is already registered`);
    }
    this.checks.set(name, check);
  }

  async readiness(): Promise<ReadinessReport> {
    const results = await Promise.all(
      [...this.checks].map(([name, check]) => this.runCheck(name, check)),
    );
    return {
      status: results.every((result) => result.status === 'ok') ? 'ok' : 'error',
      service: this.serviceName,
      checks: results,
    };
  }

  private async runCheck(name: string, check: HealthCheck): Promise<DependencyCheck> {
    const startedAt = performance.now();
    try {
      await withTimeout(check(), this.timeoutMs);
      return { name, status: 'ok', latencyMs: elapsedSince(startedAt) };
    } catch (error) {
      this.logger.warn({ err: error, check: name }, 'Readiness check failed');
      return { name, status: 'error', latencyMs: elapsedSince(startedAt) };
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
