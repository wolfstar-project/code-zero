/** The part of a Hyperdrive binding this app reads: where to connect for the current request. */
interface HyperdriveBinding {
  readonly connectionString: string;
}

/** What the selection needs of the request being served. */
export interface RequestScope {
  readonly context: object;
}

export interface RequestDatabaseOptions<Client extends object> {
  /** The request being served, or nothing when none is in progress. */
  readonly request: () => RequestScope | undefined;
  /** Opens a client for the connection string a Hyperdrive binding hands this request. */
  readonly open: (connectionString: string) => Client;
  /** The client for everything that did not arrive through a Hyperdrive binding. */
  readonly fallback: () => Client;
}

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

/**
 * Picks the client for the work in progress.
 *
 * A request that arrived through a Hyperdrive binding gets a client of its own, opened on first use
 * and reused for the rest of that request. A new client for every request is the point: a socket
 * opened while serving one cannot be used by the next, which is why a Worker cannot share a
 * process-wide pool. Anything else, including code running outside a request, gets the fallback.
 */
export function createRequestDatabase<Client extends object>(
  options: RequestDatabaseOptions<Client>,
): () => Client {
  const clients = new WeakMap<object, Client>();

  return () => {
    const request = options.request();
    const binding = hyperdriveBinding(
      request && 'cloudflare' in request.context ? request.context.cloudflare : undefined,
    );
    if (!request || !binding) return options.fallback();

    let client = clients.get(request);
    if (!client) {
      client = options.open(binding.connectionString);
      clients.set(request, client);
    }
    return client;
  };
}
