import {
  provisionTestDatabase as provision,
  type TestDatabaseUrls,
} from '@solmira/service-kit/testing';
import { migrateDatabase } from '../../src/database/migrations.js';

/** A fresh identity database with owner/runtime role separation (see service-kit testing). */
export function provisionTestDatabase(): Promise<TestDatabaseUrls> {
  return provision({
    database: 'solmira_identity_test',
    ownerRole: 'identity_test_owner',
    appRole: 'identity_test_app',
    migrate: migrateDatabase,
  });
}
