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
 * A contract rather than the Drizzle functions directly, so the process can run on an in-memory
 * store when it has no database — the same shape `server/auth.config.ts` takes for the session
 * store, and for the same reason: `dev:dashboard` and the Playwright preview both own the whole process
 * and throw its state away when they exit.
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
 * The in-memory stand-in, for a process running without a database.
 *
 * Seeded from `CODE_ZERO_SOLO_REPOSITORIES` because the store starts empty on every boot and the
 * procedures that would fill it require an administrator, which a freshly created throwaway
 * account is not. That variable is read here and nowhere else: it configures a fixture, not a
 * deployment, which is why the three variables this table replaced are gone rather than joined by
 * a fourth.
 *
 * Entries are `owner/name=/path` or bare `/path`; the first form is watched, the second is only
 * allow-listed. A malformed entry is dropped, the same way the poller's own configuration was.
 */
function memoryRepositoryStore(seed: string | undefined): RepositoryStore {
  const records = new Map<string, RepositoryRecord>();
  let sequence = 0;

  const put = (input: RepositoryInput): RepositoryRecord => {
    const existing = [...records.values()].find(
      (record) => record.checkoutPath === input.checkoutPath,
    );
    sequence += 1;
    const record: RepositoryRecord = {
      id: existing?.id ?? `repo_${String(sequence)}`,
      provider: input.provider?.trim() || 'github',
      owner: input.owner?.trim() || null,
      name: input.name?.trim() || null,
      checkoutPath: input.checkoutPath,
      mode: input.mode ?? 'observe',
      pollEnabled: input.pollEnabled ?? false,
    };
    records.set(record.id, record);
    return record;
  };

  for (const entry of (seed ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const [slug, checkoutPath] = trimmed.includes('=')
      ? trimmed.split('=', 2).map((part) => part.trim())
      : [undefined, trimmed];
    if (!checkoutPath) continue;
    const [owner, name] = (slug ?? '').split('/', 2).map((part) => part.trim());
    put({
      checkoutPath,
      ...(owner && name ? { owner, name, pollEnabled: true } : {}),
    });
  }

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
 * marks a process whose stores live and die with it, which is true of both stores or neither.
 */
export const repositoryStore: RepositoryStore =
  process.env.AUTH_E2E_MEMORY === 'true'
    ? memoryRepositoryStore(process.env.CODE_ZERO_SOLO_REPOSITORIES)
    : postgresRepositoryStore();
