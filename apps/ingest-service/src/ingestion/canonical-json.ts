import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so equal values always serialize the same way. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => JSON.stringify(key) + ':' + canonicalJson(entry));
    return '{' + entries.join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

/** Identifies a request for idempotency: the same event type and payload hash the same. */
export function requestHash(eventType: string, payload: unknown): string {
  return createHash('sha256').update(canonicalJson({ eventType, payload }), 'utf8').digest('hex');
}
