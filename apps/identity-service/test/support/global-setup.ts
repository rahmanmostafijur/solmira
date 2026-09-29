import type { TestProject } from 'vitest/node';
import { provisionTestDatabase } from './test-database.js';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    appDatabaseUrl: string;
  }
}

/** Runs once per test run: a fresh, migrated database shared by all integration test files. */
export default async function setup(project: TestProject): Promise<void> {
  const { ownerUrl, appUrl } = await provisionTestDatabase();
  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('appDatabaseUrl', appUrl);
}
