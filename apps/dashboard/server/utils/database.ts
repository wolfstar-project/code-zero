import { createDatabase, databaseUrlFromEnvironment, type Database } from '@code-zero/database';

/**
 * The one connection pool this process opens, created on first use.
 *
 * Lazy rather than at module load: a request that never touches the store — every read the board
 * makes, the health check a load balancer polls — should not have opened a socket, and a process
 * running on in-memory stores must be able to import this module without a database existing at
 * all. `createDatabase` is a factory for the same reason; the composition root owns the lifetime,
 * and this is that root.
 *
 * One pool per process rather than one per request: `postgres` pools internally, and a client per
 * request would exhaust the server's connection limit under any real load.
 */
let pool: Database | undefined;

export function database(): Database {
  pool ??= createDatabase({ connectionString: databaseUrlFromEnvironment() });
  return pool;
}
