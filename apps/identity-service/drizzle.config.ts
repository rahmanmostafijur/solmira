import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs the schema into a new SQL migration. Review every generated file;
// Row Level Security lives in hand-written migrations next to it.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
