import type { FetchLike } from 'forges';
import { providersFromEnv } from 'forges/env';

import type { PreparedConnection } from './connections.js';
import { isForgeKind } from './contracts.js';

/** One set of `FORGES_*` variables that could not become a connection, and why. */
export interface SkippedConnection {
  forge: string;
  /** The suffix that started the set, empty for the unsuffixed one. */
  suffix: string;
  /** Safe to log: it never contains a credential. */
  reason: string;
}

export interface EnvironmentConnections {
  connections: PreparedConnection[];
  skipped: SkippedConnection[];
}

/**
 * Read forge connections from `FORGES_<KIND>_<FIELD>[_<SUFFIX>]` variables, for a self-hosted
 * deployment without a database of connections.
 *
 * `forges/env` builds the factories, so the credentials never pass through Code Zero. Every set
 * that does not become a connection is reported rather than dropped, including forges `forges`
 * supports but Code Zero does not connect to.
 */
export function connectionsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  options: { fetch?: FetchLike } = {},
): EnvironmentConnections {
  const connections: PreparedConnection[] = [];
  const skipped: SkippedConnection[] = [];
  for (const entry of providersFromEnv({ ...env }, options)) {
    const { forge, suffix } = entry;
    if (entry.skipped !== undefined) skipped.push({ forge, suffix, reason: entry.skipped });
    else if (!isForgeKind(forge))
      skipped.push({ forge, suffix, reason: 'Code Zero does not connect to this forge' });
    else if (entry.factory === undefined)
      skipped.push({ forge, suffix, reason: 'the variables configured no provider' });
    else connections.push({ kind: forge, factory: entry.factory });
  }
  return { connections, skipped };
}
