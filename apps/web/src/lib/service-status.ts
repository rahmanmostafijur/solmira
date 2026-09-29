import { SERVICES, readinessReportSchema, type DependencyCheck } from '@solmira/contracts';

export type ServiceState = 'ready' | 'degraded' | 'unreachable';

export interface ServiceStatus {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly state: ServiceState;
  readonly checks: readonly DependencyCheck[];
}

type ServiceInfo = (typeof SERVICES)[number];

export const PROBE_TIMEOUT_MS = 3_000;

/**
 * A service that answers with a valid readiness report is "ready" or "degraded". Anything else
 * (gateway 503 envelope, timeout, malformed body) means the service itself is unreachable.
 */
export function toServiceStatus(service: ServiceInfo, body: unknown): ServiceStatus {
  const base = { key: service.key, name: service.name, description: service.description };
  const report = readinessReportSchema.safeParse(body);
  if (!report.success) {
    return { ...base, state: 'unreachable', checks: [] };
  }
  return {
    ...base,
    state: report.data.status === 'ok' ? 'ready' : 'degraded',
    checks: report.data.checks,
  };
}

export async function fetchServiceStatuses(
  gatewayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ServiceStatus[]> {
  return Promise.all(
    SERVICES.map(async (service) => {
      try {
        const response = await fetchImpl(`${gatewayUrl}/internal/health/${service.key}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return toServiceStatus(service, await response.json());
      } catch {
        return toServiceStatus(service, undefined);
      }
    }),
  );
}
