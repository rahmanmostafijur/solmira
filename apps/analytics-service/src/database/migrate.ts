import { loadConfig, runService } from '@solmira/service-kit';
import { z } from 'zod';
import { migrateDatabase } from './migrations.js';

// Deployment step (one-off task before the new version starts): `node dist/database/migrate.js`.
await runService(async () => {
  const { MIGRATION_DATABASE_URL } = loadConfig(
    z.object({ MIGRATION_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) }),
  );
  await migrateDatabase(MIGRATION_DATABASE_URL);
  process.stdout.write('analytics-service: migrations applied\n');
});
