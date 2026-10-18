import { createForges, type FetchLike, type ForgeProvider } from 'forges';

import { forgeCapabilities } from './capabilities.js';
import {
  assertConnection,
  connectionFactory,
  connectionSecrets,
  isPreparedConnection,
  type ForgeConnection,
  type PreparedConnection,
} from './connections.js';
import type { ForgeCapabilities, ForgeKind, ForgeRepository } from './contracts.js';
import { ForgeConfigurationError } from './errors.js';

/** One registered connection, without its credentials. */
export interface RegisteredForge {
  kind: ForgeKind;
  instance: string;
  baseUrl: string;
  /** The credential kind, `anonymous` when the connection sends none. */
  authKind: string;
  capabilities: ForgeCapabilities;
}

/** Every configured forge connection, routed by forge kind and instance host. */
export interface ForgeRegistry {
  /** The provider for a forge, optionally narrowed to one instance host. */
  get(kind: ForgeKind, instance?: string): ForgeProvider | undefined;
  list(): RegisteredForge[];
}

export interface ForgeRegistryOptions {
  /** Passed to every provider built from a `ForgeConnection`, so tests never touch the network. */
  fetch?: FetchLike;
}

// Credentials are kept beside the provider rather than on the registry's surface, so redaction
// can reach them without any caller being able to read them back.
const secretsByProvider = new WeakMap<ForgeProvider, readonly string[]>();

/** The credential values of the connection a provider was built from. */
export function providerSecrets(provider: ForgeProvider): readonly string[] {
  return secretsByProvider.get(provider) ?? [];
}

/**
 * Build the registry for a deployment's forge connections.
 *
 * Each connection becomes a `forges` provider, and `createForges()` refuses two connections that
 * share a forge and an instance, so a delivery or a ref can never be routed ambiguously.
 */
export function createForgeRegistry(
  connections: readonly (ForgeConnection | PreparedConnection)[],
  options: ForgeRegistryOptions = {},
): ForgeRegistry {
  const providers = connections.map((connection) => {
    if (isPreparedConnection(connection)) {
      const provider = connection.factory.create();
      if (provider.forge !== connection.kind)
        throw new ForgeConfigurationError(
          connection.kind,
          `the factory builds a ${provider.forge} provider`,
        );
      return { kind: connection.kind, provider };
    }
    assertConnection(connection);
    const provider = connectionFactory(connection, options.fetch).create();
    if (!provider.capabilities.authKinds.includes(connection.auth.type))
      throw new ForgeConfigurationError(
        connection.kind,
        `does not accept ${connection.auth.type} credentials`,
      );
    secretsByProvider.set(provider, connectionSecrets(connection));
    return { kind: connection.kind, provider };
  });
  const forges = createForges(providers.map((entry) => entry.provider));

  return {
    get: (kind, instance) => forges.get(kind, instance),
    list: () =>
      providers.map(({ kind, provider }) => ({
        kind,
        instance: provider.instance,
        baseUrl: provider.baseUrl,
        authKind: provider.authKind,
        capabilities: forgeCapabilities(kind, provider),
      })),
  };
}

/** The provider a repository belongs to, or a configuration error naming what is missing. */
export function providerFor(
  registry: ForgeRegistry,
  target: Pick<ForgeRepository, 'forge' | 'instance'>,
): ForgeProvider {
  const provider = registry.get(target.forge, target.instance);
  if (!provider)
    throw new ForgeConfigurationError(target.forge, `no connection for ${target.instance}`);
  return provider;
}
