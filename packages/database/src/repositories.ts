import { and, asc, eq, isNotNull } from 'drizzle-orm';

import type { Database } from './client.js';
import { repository } from './schema/repository.js';

/**
 * A configured repository, as every consumer outside this package sees one.
 *
 * Named here rather than inferred at each call site so nothing else has to spell out a Drizzle
 * generic, and so a column rename is a compile error in one place instead of a silent shape change
 * everywhere.
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

/**
 * The modes a repository may be configured with.
 *
 * Only the two that cannot modify a checkout. Work the deployment starts on its own — a poll, a
 * webhook delivery — is never something an operator asked for at that moment, so the writable
 * modes stay reachable only through an explicit request that carries its own authorization.
 */
export type RepositoryMode = 'observe' | 'suggest';

const MODES = new Set<string>(['observe', 'suggest']);

function isMode(value: string): value is RepositoryMode {
  return MODES.has(value);
}

/** A repository that is watched: it has provider coordinates and polling is on. */
export interface WatchedRepositoryRecord extends RepositoryRecord {
  owner: string;
  name: string;
}

/** What a caller supplies to configure one; the store mints the identity. */
export interface RepositoryInput {
  provider?: string;
  owner?: string | null;
  name?: string | null;
  checkoutPath: string;
  mode?: RepositoryMode;
  pollEnabled?: boolean;
}

/** Every configured repository, oldest first, so a list reads in the order it was built. */
export async function listRepositories(database: Database): Promise<RepositoryRecord[]> {
  const rows = await database.select().from(repository).orderBy(asc(repository.createdAt));
  return rows.map(toRecord);
}

/**
 * The repositories the poller looks for work in.
 *
 * Filtered in the query rather than by the caller: a row with polling on but no provider
 * coordinates describes nothing to ask a provider about, and letting it through would make every
 * pass build a request it cannot send.
 */
export async function watchedRepositories(database: Database): Promise<WatchedRepositoryRecord[]> {
  const rows = await database
    .select()
    .from(repository)
    .where(
      and(
        eq(repository.pollEnabled, true),
        isNotNull(repository.owner),
        isNotNull(repository.name),
      ),
    )
    .orderBy(asc(repository.createdAt));
  return rows
    .map(toRecord)
    .filter((record): record is WatchedRepositoryRecord => isWatched(record));
}

/**
 * Whether a run may execute against this checkout path.
 *
 * A single indexed lookup rather than loading the list and scanning it, so the cost does not grow
 * with the number of configured repositories on a surface that runs before every task creation.
 * The path is compared exactly as stored; callers resolve it first, which is what keeps
 * `/srv/app` and `/srv/app/../app` from being different answers.
 */
export async function isAllowedCheckout(
  database: Database,
  checkoutPath: string,
): Promise<boolean> {
  const [row] = await database
    .select({ id: repository.id })
    .from(repository)
    .where(eq(repository.checkoutPath, checkoutPath))
    .limit(1);
  return row !== undefined;
}

/**
 * Add a repository, or update the one already claiming this checkout path.
 *
 * An upsert on the path rather than an insert that fails: the path is the identity an operator
 * thinks in, and configuring the same checkout twice should read as correcting it rather than as
 * an error they have to resolve by deleting first.
 */
export async function saveRepository(
  database: Database,
  input: RepositoryInput,
  id: () => string = () => globalThis.crypto.randomUUID(),
): Promise<RepositoryRecord> {
  const values = {
    id: id(),
    provider: input.provider?.trim() || 'github',
    owner: input.owner?.trim() || null,
    name: input.name?.trim() || null,
    checkoutPath: input.checkoutPath,
    mode: input.mode ?? 'observe',
    pollEnabled: input.pollEnabled ?? false,
  };
  // Every field here is optional on `input` (see `RepositoryInput`), so an update names only the
  // fields it means to change — a caller correcting a repository's `checkoutPath` alone must not
  // also reset its mode to `observe` or turn its polling off. Only a field `input` actually named
  // is written on conflict; one left out keeps the row's current value instead of `values`' default.
  const set: {
    provider?: string;
    owner?: string | null;
    name?: string | null;
    mode?: RepositoryMode;
    pollEnabled?: boolean;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (input.provider !== undefined) set.provider = values.provider;
  if (input.owner !== undefined) set.owner = values.owner;
  if (input.name !== undefined) set.name = values.name;
  if (input.mode !== undefined) set.mode = values.mode;
  if (input.pollEnabled !== undefined) set.pollEnabled = values.pollEnabled;

  const [row] = await database
    .insert(repository)
    .values(values)
    .onConflictDoUpdate({ target: repository.checkoutPath, set })
    .returning();
  if (!row) throw new Error('The repository could not be saved');
  return toRecord(row);
}

/** Remove a repository by id. Reports whether anything was removed, so a caller can say so. */
export async function deleteRepository(database: Database, id: string): Promise<boolean> {
  const removed = await database
    .delete(repository)
    .where(eq(repository.id, id))
    .returning({ id: repository.id });
  return removed.length > 0;
}

/**
 * Narrow a stored row to the contract above.
 *
 * `mode` is checked rather than trusted: it is a text column an operator can edit directly, and a
 * value outside the union would otherwise reach the runtime as a mode nothing enforces. Anything
 * unrecognised reads as `observe`, the mode that cannot write.
 */
function toRecord(row: typeof repository.$inferSelect): RepositoryRecord {
  return {
    id: row.id,
    provider: row.provider,
    owner: row.owner,
    name: row.name,
    checkoutPath: row.checkoutPath,
    mode: isMode(row.mode) ? row.mode : 'observe',
    pollEnabled: row.pollEnabled,
  };
}

function isWatched(record: RepositoryRecord): boolean {
  return record.owner !== null && record.name !== null;
}
