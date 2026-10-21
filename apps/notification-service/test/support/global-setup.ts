import { provisionTestDatabase } from '@solmira/service-kit/testing';
import type { TestProject } from 'vitest/node';
import { migrateDatabase } from '../../src/database/migrations.js';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    appDatabaseUrl: string;
  }
}

/** A fresh, migrated database with separate owner and runtime roles, shared by the test files. */
export default async function setup(project: TestProject): Promise<void> {
  const { ownerUrl, appUrl } = await provisionTestDatabase({
    database: 'solmira_notification_test',
    ownerRole: 'notification_test_owner',
    appRole: 'notification_test_app',
    migrate: migrateDatabase,
  });
  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('appDatabaseUrl', appUrl);
}
