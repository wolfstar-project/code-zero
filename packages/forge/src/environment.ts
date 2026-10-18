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
    else connections.push({ kind: forge, factory: entry.factory, secrets: secretsOf(env, entry) });
  }
  return { connections, skipped };
}

/** The `forges/env` fields that carry a credential rather than a setting. */
const SECRET_FIELDS = ['TOKEN', 'PASSWORD', 'PRIVATE_KEY', 'WEBHOOK_SECRET'] as const;

/**
 * The credential values one variable set configured, read back from the same environment object
 * `forges/env` built the factory from. That object need not be `process.env`, so the environment
 * fallback of every redaction would not find them on its own.
 */
function secretsOf(
  env: Readonly<Record<string, string | undefined>>,
  set: { forge: string; suffix: string },
): string[] {
  const prefix = `FORGES_${set.forge.toUpperCase().replaceAll('-', '_')}_`;
  const values: string[] = [];
  for (const field of SECRET_FIELDS) {
    const value = env[`${prefix}${field}${set.suffix ? `_${set.suffix}` : ''}`];
    if (!value) continue;
    values.push(value);
    // `forges/env` turns escaped newlines in a PEM key into real ones before using it.
    if (field === 'PRIVATE_KEY' && value.includes('\\n'))
      values.push(value.replaceAll('\\n', '\n'));
  }
  return values;
}
