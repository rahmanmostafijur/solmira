import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs the schema into a new SQL migration. Review every generated file;
// Row Level Security policies live in hand-written migrations next to the generated ones.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
