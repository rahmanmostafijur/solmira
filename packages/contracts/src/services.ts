export const SERVICES = [
  {
    key: 'identity',
    name: 'Identity',
    description: 'Authentication, organizations, members and roles',
  },
  {
    key: 'operations',
    name: 'Operations',
    description: 'Catalog, inventory, purchasing, orders and fulfillment',
  },
  {
    key: 'notification',
    name: 'Notifications',
    description: 'In-app, email and real-time delivery',
  },
  { key: 'analytics', name: 'Analytics', description: 'Dashboard read models and reporting' },
  { key: 'audit', name: 'Audit', description: 'Audit trail and event history' },
] as const;

export type ServiceKey = (typeof SERVICES)[number]['key'];
