export const SERVICES = [
  {
    key: 'identity',
    name: 'Identity',
    description: 'Authentication, organizations, members and roles',
  },
  {
    key: 'ingest',
    name: 'Ingest',
    description: 'Applications, event types, endpoints and message ingestion',
  },
  {
    key: 'notification',
    name: 'Notifications',
    description: 'Tenant alerts about failing endpoints',
  },
  { key: 'analytics', name: 'Analytics', description: 'Delivery success rates and latency' },
  { key: 'audit', name: 'Audit', description: 'Audit trail of administrative actions' },
] as const;

export type ServiceKey = (typeof SERVICES)[number]['key'];
