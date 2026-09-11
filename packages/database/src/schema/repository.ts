import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { timestampColumns } from './columns.js';

/**
 * The repositories a deployment may act on, and where each one lives on this host.
 *
 * This is operator policy that changes while the process runs — a repository is added, paused, or
 * pointed at a different checkout — so it is data rather than configuration. It replaces three
 * environment variables (`CODE_ZERO_CONTROL_PLANE_REPOSITORIES`, `CODE_ZERO_POLL_REPOSITORIES`,
 * `CODE_ZERO_POLL_MODE`) that had to be edited and the deployment restarted, and that stated the
 * same repository twice in two different formats with nothing keeping them in step.
 *
 * The row answers two questions that were previously answered separately:
 *
 * - **May a run target this checkout?** `checkout_path` is the allow-list. A task creation names a
 *   path and it is accepted only when a row claims it, which is what keeps an HTTP caller from
 *   pointing a run at an arbitrary server-local directory.
 * - **Should work be looked for here?** `poll_enabled` with `owner`/`name` is the watch list.
 *
 * `owner` and `name` are nullable because the two questions are independent: a checkout may be
 * allow-listed for runs started by hand without being watched on any provider. Polling requires
 * both, which {@link watchedRepositories} enforces in the query rather than leaving to a caller.
 */
export const repository = pgTable(
  'repository',
  {
    id: text('id').primaryKey(),
    /** Which source-control provider `owner`/`name` are coordinates on. */
    provider: text('provider').notNull().default('github'),
    owner: text('owner'),
    name: text('name'),
    /**
     * The absolute path on this host a run may execute against.
     *
     * Never derived from `owner`/`name`: deriving it is how a run ends up in a directory nobody
     * named. Unique, so two rows cannot disagree about which repository a checkout belongs to.
     */
    checkoutPath: text('checkout_path').notNull(),
    /**
     * The execution mode the poller requests for this repository.
     *
     * Only the two non-writable modes are accepted, checked where rows are written rather than
     * constrained here: work nobody asked for must not be able to modify a checkout, and a mode
     * that reached this column would be enforced nowhere else.
     */
    mode: text('mode').notNull().default('observe'),
    /** Whether the poller looks for open pull requests here. */
    pollEnabled: boolean('poll_enabled').notNull().default(false),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('repository_checkout_path_unique').on(table.checkoutPath),
    // A provider repository is watched by at most one row, so two rows cannot start two reviews of
    // the same commit against two checkouts.
    uniqueIndex('repository_provider_owner_name_unique').on(
      table.provider,
      table.owner,
      table.name,
    ),
    index('repository_poll_enabled_idx').on(table.pollEnabled),
  ],
);
