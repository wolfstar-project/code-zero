/**
 * Which execution modes a configured repository may run un-requested work under. Only the two
 * that cannot modify a checkout: a poll or a webhook delivery is never something an operator
 * asked for at that moment, so the writable modes stay reachable only through an explicit request
 * that carries its own authorization.
 */
export type RepositoryMode = 'observe' | 'suggest';

/**
 * A configured repository, as the router sees one.
 *
 * Defined here rather than imported from `@code-zero/database`: this package composes adapters
 * into the control-plane API and does not talk to a store directly, so the contract it needs is
 * the shape a store returns, not the store itself. `apps/dashboard`'s Drizzle-backed store
 * satisfies this structurally, with no import back the other way.
 */
export interface RepositoryRecord {
  id: string;
  provider: string;
  owner: string | null;
  name: string | null;
  checkoutPath: string;
  mode: RepositoryMode;
  pollEnabled: boolean;
}

/** What a caller supplies to configure one; the store mints the identity. */
export interface RepositoryInput {
  provider?: string | undefined;
  owner?: string | null | undefined;
  name?: string | null | undefined;
  checkoutPath: string;
  mode?: RepositoryMode | undefined;
  pollEnabled?: boolean | undefined;
}

/**
 * The repository configuration surface a deployment's store backs, reached through
 * `repositories.list`/`.save`/`.remove`.
 *
 * This is the supported way to populate the allow-list `tasks.create` checks: the table starts
 * empty on every deployment, including one upgrading from an environment-variable allow-list, and
 * an administrator reaches for these procedures rather than a database console to fill it in.
 */
export interface RepositoryAdmin {
  list(): Promise<RepositoryRecord[]>;
  save(input: RepositoryInput): Promise<RepositoryRecord>;
  remove(id: string): Promise<boolean>;
}
