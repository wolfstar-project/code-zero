import type { AuditOutcome } from '@code-zero/api';

/**
 * Where a row came from.
 *
 * The two trails are stored by different systems and cannot be merged upstream: the control plane
 * appends its own records to this deployment's KV store, while authentication events live in
 * Better Auth's hosted infrastructure and are only readable through its client. The page shows
 * them side by side, so a reader has to be able to tell which system vouches for a row.
 */
export type AuditSource = 'control-plane' | 'authentication';

/**
 * One row of the audit page, from either trail.
 *
 * A view model rather than `AuditEvent` because the two sources genuinely disagree on shape.
 * `AuditEvent` requires an outcome, and a hosted authentication record carries none — only an
 * event type. Mapping those to `success` so they fit would state, in the one artifact where it
 * matters most, that a sign-in succeeded when nothing said so. Here the field is optional and the
 * table renders nothing when it is absent.
 *
 * The string fields are pre-formatted rather than structured: both mappers already know how to
 * render their own source, and the table then has one shape to lay out instead of two.
 */
export interface AuditRow {
  /** Unique within the merged list; the mappers namespace their source's identifier. */
  id: string;
  /** ISO-8601, which is what the table sorts on. */
  occurredAt: string;
  source: AuditSource;
  actorName: string;
  /** Free-form on purpose: the control plane's principal kinds and Better Auth's differ. */
  actorKind: string;
  action: string;
  /** Empty when the record names nothing. */
  subject: string;
  /** Absent when the source does not record one — see above. */
  outcome?: AuditOutcome;
  /** Empty when there is nothing more to say; rendered as one secondary line. */
  details: string;
}
