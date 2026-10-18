import type { FetchLike, ForgeProviderFactory } from 'forges';
import { azureDevOps } from 'forges/azure-devops';
import { bitbucket } from 'forges/bitbucket';
import { forgejo } from 'forges/forgejo';
import { gitea } from 'forges/gitea';
import { github } from 'forges/github';
import { gitlab } from 'forges/gitlab';

import { isForgeKind, type ForgeKind } from './contracts.js';
import { ForgeConfigurationError } from './errors.js';

/** A personal, project or OAuth access token. */
export interface TokenCredential {
  type: 'token';
  token: string;
}

/** GitHub App credentials; the provider mints and caches installation tokens itself. */
export interface AppCredential {
  type: 'app';
  appId: string | number;
  privateKey: string;
  installationId?: string | number;
}

/**
 * HTTP Basic credentials: an Atlassian account email with an API token on Bitbucket Cloud, or a
 * user name with a personal access token on Azure DevOps.
 */
export interface BasicCredential {
  type: 'basic';
  username: string;
  password: string;
}

interface ConnectionBase {
  /** Host the connection's refs carry, such as `github.com` or `git.example.com`. */
  instance: string;
  /** API base URL; the forge's public instance when omitted. */
  baseUrl?: string;
  /** Verifies inbound deliveries. Without one no delivery verifies. */
  webhookSecret?: string;
  /** Every write rejects, whatever the credential could do. */
  readOnly?: boolean;
}

/** One forge connection as an operator or the database describes it. */
export type ForgeConnection =
  | (ConnectionBase & { kind: 'github'; auth: TokenCredential | AppCredential })
  | (ConnectionBase & { kind: 'gitlab' | 'gitea' | 'forgejo'; auth: TokenCredential })
  | (ConnectionBase & { kind: 'bitbucket'; auth: TokenCredential | BasicCredential })
  | (ConnectionBase & {
      kind: 'azure-devops';
      /** The organization, or the collection on Azure DevOps Server. */
      organization: string;
      auth: TokenCredential | BasicCredential;
    });

/**
 * A connection whose provider factory already exists, such as one `forges/env` built.
 *
 * The credentials stay inside the factory, so nothing in Code Zero ever holds them.
 */
export interface PreparedConnection {
  kind: ForgeKind;
  factory: ForgeProviderFactory;
}

export function isPreparedConnection(
  connection: ForgeConnection | PreparedConnection,
): connection is PreparedConnection {
  return 'factory' in connection;
}

/** Every credential value a connection carries, so failures can be redacted against them. */
export function connectionSecrets(connection: ForgeConnection): string[] {
  const values: string[] = connection.webhookSecret ? [connection.webhookSecret] : [];
  const { auth } = connection;
  if (auth.type === 'token') values.push(auth.token);
  else if (auth.type === 'basic') values.push(auth.password);
  else values.push(auth.privateKey);
  return values;
}

/**
 * Connections may arrive from a database row, so the shape the types promise is checked again.
 * Messages name the field, never its value.
 */
export function assertConnection(connection: ForgeConnection): void {
  const kind: unknown = connection.kind;
  if (!isForgeKind(kind))
    throw new ForgeConfigurationError(String(kind), 'is not a forge Code Zero connects to');
  if (connection.instance.trim().length === 0)
    throw new ForgeConfigurationError(kind, 'a connection needs an instance host');
  if (connection.kind === 'azure-devops' && connection.organization.trim().length === 0)
    throw new ForgeConfigurationError(kind, 'an Azure DevOps connection needs an organization');
  const { auth } = connection;
  const missing =
    (auth.type === 'token' && auth.token.length === 0) ||
    (auth.type === 'basic' && (auth.username.length === 0 || auth.password.length === 0)) ||
    (auth.type === 'app' && auth.privateKey.length === 0);
  if (missing) throw new ForgeConfigurationError(kind, `the ${auth.type} credential is empty`);
}

/** The `forges` factory for one connection. Nothing touches the network until it is used. */
export function connectionFactory(
  connection: ForgeConnection,
  fetch: FetchLike | undefined,
): ForgeProviderFactory {
  const base = {
    instance: connection.instance,
    ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
    ...(connection.webhookSecret === undefined ? {} : { webhookSecret: connection.webhookSecret }),
    ...(connection.readOnly === true ? { readOnly: true } : {}),
    ...(fetch === undefined ? {} : { fetch }),
  };
  switch (connection.kind) {
    case 'github':
      return github({ ...base, auth: connection.auth });
    case 'gitlab':
      return gitlab({ ...base, auth: connection.auth });
    case 'gitea':
      return gitea({ ...base, auth: connection.auth });
    case 'forgejo':
      return forgejo({ ...base, auth: connection.auth });
    case 'bitbucket':
      return bitbucket({ ...base, auth: connection.auth });
  }
  return azureDevOps({ ...base, organization: connection.organization, auth: connection.auth });
}
