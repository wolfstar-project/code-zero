import { defineConfig } from 'drizzle-kit';

import { optionalDatabaseUrlFromEnvironment } from './src/client.js';

/**
 * Migrations are generated into `drizzle/` and checked in, so the store's shape is reviewable in a
 * diff instead of being produced on the fly at deploy time.
 *
 * The connection string is resolved by the same function the server uses, rather than by reading
 * the variables again here: a second copy of the precedence rule is how migrations end up pointed
 * at a different database than the process they are meant to migrate.
 *
 * The local default exists because `db:generate` only reads the schema files and never connects;
 * `db:migrate` is what needs a real `DATABASE_URL`.
 */
const LOCAL_DEVELOPMENT_URL = 'postgres://postgres:postgres@localhost:5432/code_zero_auth';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: optionalDatabaseUrlFromEnvironment() ?? LOCAL_DEVELOPMENT_URL,
  },
});
