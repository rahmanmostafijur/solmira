import { provisionTestDatabase } from '@solmira/service-kit/testing';
import type { TestProject } from 'vitest/node';
import { migrateDatabase } from '../../src/database/migrations.js';
import { ensureTestBucket } from './test-app.js';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    appDatabaseUrl: string;
  }
}

/** Runs once per test run: a fresh, migrated database shared by all integration test files. */
export default async function setup(project: TestProject): Promise<void> {
  const { ownerUrl, appUrl } = await provisionTestDatabase({
    database: 'solmira_operations_test',
    ownerRole: 'operations_test_owner',
    appRole: 'operations_test_app',
    migrate: migrateDatabase,
  });
  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('appDatabaseUrl', appUrl);
  await ensureTestBucket();
}
