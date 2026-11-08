import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { schema } from './schema/index.js';
import type { Schema } from './schema/index.js';

/**
 * The database client, as every consumer sees it.
 *
 * Named so that callers can hold a connection without naming Drizzle's inferred generic, which
 * TypeScript cannot write out in an emitted declaration file.
 */
export type Database = ReturnType<typeof drizzle<Schema>>;

/** How a client is opened. */
export interface DatabaseOptions {
  /** Postgres connection string. */
  readonly connectionString: string;
  /**
   * Upper bound on pooled connections.
   *
   * A small cap keeps one process from monopolizing the database's connection limit alongside
   * whatever else shares it.
   */
  readonly maximumConnections?: number;
  /**
   * Whether `postgres` asks the server for its array types when it connects.
   *
   * It is on by default. Behind Hyperdrive it is turned off, as Cloudflare documents for this
   * driver: the lookup costs a round trip on every new connection, and no table here has an array
   * column whose type the driver would need to learn.
   */
  readonly fetchTypes?: boolean;
}

/** Matches the default cap Postgres ships with divided across a handful of processes. */
export const DEFAULT_MAXIMUM_CONNECTIONS = 10;

/**
 * Open a connection pool.
 *
 * A factory rather than a module-level singleton, so importing this package never opens a socket
 * and tests can construct an isolated client without reaching into the environment. Composition
 * roots own the lifetime of what they open.
 */
export function createDatabase(options: DatabaseOptions): Database {
  const connection = postgres(options.connectionString, {
    max: options.maximumConnections ?? DEFAULT_MAXIMUM_CONNECTIONS,
    ...(options.fetchTypes === undefined ? {} : { fetch_types: options.fetchTypes }),
  });

  return drizzle(connection, { schema });
}

/**
 * A database that is looked up each time it is used, rather than opened once.
 *
 * A Cloudflare Worker cannot reuse a socket across requests: one opened while serving a request is
 * unusable from the next, so a connection held in module state breaks on the second request.
 * Libraries that take a database once, when they are built (Better Auth does), therefore need an
 * object that stays the same while the client behind it follows the request. `resolve` returns the
 * client for the work in progress; every property read and call goes to it, so the caller never
 * holds a connection of its own.
 *
 * Functions are bound to the client they were read from, so a method detached from the proxy still
 * runs against the client that was current when it was read.
 */
export function createScopedDatabase<Client extends object>(resolve: () => Client): Client {
  // The target only has to be an object: every trap answers from `resolve()`, so nothing is ever
  // read from it. Typing it as `Client` is the one place a proxy needs to claim a shape it does not
  // have, which is also why this is generic, so callers and tests never assert anything themselves.
  // oxlint-disable-next-line no-unsafe-type-assertion -- the traps answer from the resolved client
  const target = {} as Client;
  return new Proxy(target, {
    get(_target, property) {
      const client = resolve();
      // Property reads are the proxy's whole job; the key is whatever the caller asked for.
      // oxlint-disable-next-line anti-slop/no-reflect-get -- forwarding an arbitrary key to the client
      const value: unknown = Reflect.get(client, property, client);
      return typeof value === 'function' ? value.bind(client) : value;
    },
    has(_target, property) {
      return Reflect.has(resolve(), property);
    },
  });
}

/**
 * The variable a deployment sets to point at Postgres.
 *
 * `AUTH_DATABASE_URL` is still read as a fallback because the store used to live inside
 * `packages/auth`, and a deployment configured before the split must not fail to start on upgrade.
 */
export const DATABASE_URL_VARIABLE = 'DATABASE_URL';
const LEGACY_DATABASE_URL_VARIABLE = 'AUTH_DATABASE_URL';

/**
 * Read the connection string from the environment, or report that it is not configured.
 *
 * A variable set to an empty or whitespace-only value counts as unset, so a deployment that
 * blanks `DATABASE_URL` still falls back to the legacy name instead of resolving to nothing.
 *
 * The environment is passed in so callers stay deterministic in tests.
 */
export function optionalDatabaseUrlFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return (
    environment[DATABASE_URL_VARIABLE]?.trim() ||
    environment[LEGACY_DATABASE_URL_VARIABLE]?.trim() ||
    undefined
  );
}

/**
 * Read the connection string from the environment.
 *
 * Throws when neither variable is set: a missing connection string is a deployment error, and a
 * default would point a production process at a local database. The message names the variable
 * but never echoes its value, which would leak the password embedded in a Postgres URL.
 *
 * This is the one place the precedence between the two variable names is decided; `drizzle.config.ts`
 * resolves through the same function so migrations cannot disagree with the running server about
 * which database they mean.
 */
export function databaseUrlFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const url = optionalDatabaseUrlFromEnvironment(environment);
  if (!url) throw new Error(`missing required environment variable: ${DATABASE_URL_VARIABLE}`);
  return url;
}
