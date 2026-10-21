import type { AuditRecord } from '@solmira/contracts';

/** `endpoint_secret.revealed` as "Endpoint secret revealed". */
export function actionLabel(action: string): string {
  const text = action.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const TARGET_LABELS: Record<AuditRecord['targetType'], string> = {
  organization: 'Organization',
  member: 'Member',
  invitation: 'Invitation',
  application: 'Application',
  api_key: 'API key',
  event_type: 'Event type',
  endpoint: 'Endpoint',
  message: 'Message',
};

export const targetLabel = (type: AuditRecord['targetType']): string => TARGET_LABELS[type];

/** Who acted: the platform itself, or a person by the start of their id (names live in identity). */
export function actorLabel(record: Pick<AuditRecord, 'actorType' | 'actorId'>): string {
  if (record.actorType === 'system' || !record.actorId) return 'Platform';
  return record.actorId.slice(0, 8);
}

/** The ids and field names of an event, one per line, for people who want the detail. */
export function describeDetails(details: Record<string, unknown>): string {
  return JSON.stringify(details, null, 2);
}
