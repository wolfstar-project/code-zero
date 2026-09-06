import { account, session, user, verification } from './auth.js';
import { deviceCode } from './device.js';
import { invite, inviteUse } from './enrollment.js';
import { invitation, member, organization } from './organization.js';
import { repository } from './repository.js';

export { account, session, user, verification } from './auth.js';
export { timestampColumns } from './columns.js';
export { deviceCode } from './device.js';
export { invite, inviteUse } from './enrollment.js';
export { invitation, member, organization } from './organization.js';
export { repository } from './repository.js';

/**
 * Every table in the store, as one object.
 *
 * This is the shape Drizzle resolves relational queries against and the shape the Better Auth
 * Drizzle adapter resolves models against, so a table that is not listed here exists in SQL but
 * is invisible to both.
 *
 * The keys are model names, not SQL table names: the adapter looks a model up by the key it is
 * registered under, which is why `inviteUse` is spelled in camel case here while the table it
 * points at is `invite_use`.
 */
export const schema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  invite,
  inviteUse,
  deviceCode,
  repository,
};

/** The set of tables the database client is opened with. */
export type Schema = typeof schema;
