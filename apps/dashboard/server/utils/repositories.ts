import {
  deleteRepository,
  isAllowedCheckout,
  listRepositories,
  saveRepository,
  watchedRepositories,
  type RepositoryInput,
  type RepositoryRecord,
  type WatchedRepositoryRecord,
} from '@code-zero/database';

import { database } from './database.js';

/**
 * The repositories this deployment may act on.
 *
 * A contract rather than the Drizzle functions directly, so the Playwright preview server can run
 * on an in-memory store — the same shape `server/auth.config.ts` takes for the session store, and
 * for the same reason: that process owns its whole state and throws it away when it exits. Every
 * other process, a deployment and `aube run dev` alike, reads Postgres.
 */
export interface RepositoryStore {
  list(): Promise<RepositoryRecord[]>;
  /** Those the poller looks for work in: polling on, and provider coordinates to ask about. */
  watched(): Promise<WatchedRepositoryRecord[]>;
  /** Whether a run may execute against this checkout path. */
  allows(checkoutPath: string): Promise<boolean>;
  save(input: RepositoryInput): Promise<RepositoryRecord>;
  remove(id: string): Promise<boolean>;
}

/** The store backed by Postgres, which is every deployment. */
function postgresRepositoryStore(): RepositoryStore {
  return {
    list: () => listRepositories(database()),
    watched: () => watchedRepositories(database()),
    allows: (checkoutPath) => isAllowedCheckout(database(), checkoutPath),
    save: (input) => saveRepository(database(), input),
    remove: (id) => deleteRepository(database(), id),
  };
}

/**
 * The in-memory stand-in, for the Playwright preview server, which runs without a database.
 *
 * Starts empty and stays in the process: the e2e suite creates whatever it needs through the same
 * procedures an operator uses, and nothing seeds it from the environment, because a store that
 * outlives no process is a fixture rather than a deployment's configuration.
 */
export function memoryRepositoryStore(): RepositoryStore {
  const records = new Map<string, RepositoryRecord>();
  let sequence = 0;

  // Mirrors `saveRepository`'s upsert (`packages/database`): every field on `RepositoryInput` is
  // optional, so a save that names only `checkoutPath` corrects that path and leaves the rest of
  // the record alone. A field the input omits keeps the existing record's value — and falls back to
  // the same default as the column only when there is no existing record — so a watched
  // `owner/name` repository cannot be silently demoted to an unwatched one with no coordinates by a
  // save that never mentioned them.
  const put = (input: RepositoryInput): RepositoryRecord => {
    const existing = [...records.values()].find(
      (record) => record.checkoutPath === input.checkoutPath,
    );
    sequence += 1;
    const record: RepositoryRecord = {
      id: existing?.id ?? `repo_${String(sequence)}`,
      provider:
        input.provider === undefined
          ? (existing?.provider ?? 'github')
          : input.provider.trim() || 'github',
      owner: input.owner === undefined ? (existing?.owner ?? null) : input.owner?.trim() || null,
      name: input.name === undefined ? (existing?.name ?? null) : input.name?.trim() || null,
      checkoutPath: input.checkoutPath,
      mode: input.mode ?? existing?.mode ?? 'observe',
      pollEnabled: input.pollEnabled ?? existing?.pollEnabled ?? false,
    };
    records.set(record.id, record);
    return record;
  };

  return {
    list: () => Promise.resolve([...records.values()]),
    watched: () =>
      Promise.resolve(
        [...records.values()].filter(
          (record): record is WatchedRepositoryRecord =>
            record.pollEnabled && record.owner !== null && record.name !== null,
        ),
      ),
    allows: (checkoutPath) =>
      Promise.resolve([...records.values()].some((r) => r.checkoutPath === checkoutPath)),
    save: (input) => Promise.resolve(put(input)),
    remove: (id) => Promise.resolve(records.delete(id)),
  };
}

/**
 * The store this process uses.
 *
 * `AUTH_E2E_MEMORY` selects the in-memory one, the same flag `server/auth.config.ts` reads: it
 * marks a process whose stores live and die with it, which is true of both stores or neither. Only
 * `playwright.config.ts` sets it, so everything else here talks to Postgres.
 */
export const repositoryStore: RepositoryStore =
  process.env.AUTH_E2E_MEMORY === 'true' ? memoryRepositoryStore() : postgresRepositoryStore();
