import type { DeliveryStatus } from '@solmira/contracts';

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Waiting',
  in_progress: 'Sending',
  succeeded: 'Delivered',
  failed: 'Failed',
};

export const STATUS_TONES: Record<DeliveryStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  pending: 'neutral',
  in_progress: 'info',
  succeeded: 'success',
  failed: 'danger',
};

const ERROR_LABELS: Record<string, string> = {
  ssrf_blocked: 'Blocked target address',
  dns: 'Host name did not resolve',
  connect: 'Could not connect',
  tls: 'TLS certificate problem',
  timeout: 'Timed out',
  redirect: 'Redirects are not followed',
  http_4xx: 'Rejected by the receiver',
  http_5xx: 'Receiver error',
  http_other: 'Unexpected response',
  network: 'Network error',
  endpoint_unavailable: 'Endpoint disabled or archived',
  payload_too_large: 'Payload too large',
  signing_secret_missing: 'No signing secret',
  delivery_data_missing: 'Data missing',
};

/** A sentence for an attempt: its status code and what went wrong, in words a tenant can act on. */
export function describeAttempt(statusCode: number | null, errorClass: string | null): string {
  if (errorClass === null) return statusCode ? `Delivered (HTTP ${statusCode})` : 'Delivered';
  const reason = ERROR_LABELS[errorClass] ?? errorClass;
  return statusCode ? `${reason} (HTTP ${statusCode})` : reason;
}

/** The counts of a message as one short line, for example "2 delivered, 1 failed". */
export function summarizeDeliveries(counts: Record<DeliveryStatus, number>): string {
  const parts = (Object.keys(STATUS_LABELS) as DeliveryStatus[])
    .filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${STATUS_LABELS[status].toLowerCase()}`);
  return parts.length > 0 ? parts.join(', ') : 'No deliveries';
}
