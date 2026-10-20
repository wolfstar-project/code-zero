import {
  createDatabase,
  createScopedDatabase,
  databaseUrlFromEnvironment,
  type Database,
} from '@code-zero/database';

/** The part of a Hyperdrive binding this app reads: where to connect for the current request. */
interface HyperdriveBinding {
  readonly connectionString: string;
}

/**
 * Connections a single request may open through Hyperdrive.
 *
 * Hyperdrive owns the pool towards Postgres, so a request needs no more than a handful of its own
 * connections to it; more would only spend the Worker's six simultaneous outbound connections.
 */
const REQUEST_MAXIMUM_CONNECTIONS = 5;

/** The client opened for each request that reached Postgres through Hyperdrive. */
const requestClients = new WeakMap<object, Database>();

/** Narrows what Nitro leaves untyped on `event.context.cloudflare` to the binding this app reads. */
function hyperdriveBinding(cloudflare: unknown): HyperdriveBinding | undefined {
  if (typeof cloudflare !== 'object' || cloudflare === null || !('env' in cloudflare)) {
    return undefined;
  }
  const { env } = cloudflare;
  if (typeof env !== 'object' || env === null || !('HYPERDRIVE' in env)) return undefined;
  const { HYPERDRIVE: binding } = env;
  if (typeof binding !== 'object' || binding === null || !('connectionString' in binding)) {
    return undefined;
  }
  return typeof binding.connectionString === 'string'
    ? { connectionString: binding.connectionString }
    : undefined;
}

/** The request being served, or nothing when none is in progress or the host keeps no context. */
function requestEvent() {
  try {
    return useEvent();
  } catch {
    return undefined;
  }
}

function requestDatabase(): Database | undefined {
  const event = requestEvent();
  const binding = hyperdriveBinding(event?.context.cloudflare);
  if (!event || !binding) return undefined;

  let client = requestClients.get(event);
  if (!client) {
    // A new client for every request: a socket opened while serving one cannot be used by the next,
    // which is why a Worker cannot share the process-wide pool below. Hyperdrive keeps the
    // connections to Postgres warm, so opening a client here is cheap.
    client = createDatabase({
      connectionString: binding.connectionString,
      maximumConnections: REQUEST_MAXIMUM_CONNECTIONS,
      fetchTypes: false,
    });
    requestClients.set(event, client);
  }
  return client;
}

/**
 * The one connection pool a long-lived process opens, created on first use.
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

function processDatabase(): Database {
  pool ??= createDatabase({ connectionString: databaseUrlFromEnvironment() });
  return pool;
}

/**
 * The database every caller shares, which resolves to the right client at the moment it is used.
 *
 * A request served through a Hyperdrive binding gets a client of its own (`requestDatabase`); every
 * other request, and anything running outside one, uses the process-wide pool. The answer is a
 * property of the call and not of the module, so this single object is safe to hand to a library
 * that keeps it for good, as Better Auth does.
 */
const scopedDatabase = createScopedDatabase(() => requestDatabase() ?? processDatabase());

export function database(): Database {
  return scopedDatabase;
}
