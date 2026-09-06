import { randomUUID } from 'node:crypto';

import { now, redactSecrets, secretValuesFromEnvironment } from '@code-zero/shared';
import { auditOnly, drainPlugin, enricherPlugin, auditEnricher } from 'evlog';
import type { AuditFields, DrainFn, EvlogPlugin } from 'evlog';

import type { KeyValueStorage } from './control-plane.js';

/**
 * Who performed an audited action, in evlog's vocabulary.
 *
 * `api` is an operator token presented by a machine caller; `user` is the session-authenticated
 * dashboard user. The router derives which one from the authenticated principal's own kind, so a
 * reader never has to guess whether an actor was a human or a token — they are revoked through
 * different channels, and the trail has to say which one to go turn off.
 */
export type AuditActor = AuditFields['actor'];

/** Whether the audited attempt went through, was refused by policy, or failed while running. */
export type AuditOutcome = AuditFields['outcome'];

/**
 * One audited action, appended once and never rewritten.
 *
 * The persisted shape is evlog's own {@link AuditFields} plus the two fields a durable log needs
 * that a wide event does not carry: the storage identity and when it happened. Recording goes
 * through `log.audit()`, so this package neither defines a second audit vocabulary nor a second
 * way to write one — what the trail stores is what the wide event carried.
 *
 * The actor is denormalized onto the record rather than referenced, following the same reasoning
 * as `invite_use` in `@code-zero/database`: an audit record states who did what at a moment that
 * has already passed, and it has to keep saying so after the token is revoked or the account it
 * names is deleted. There is no `updatedAt` for the same reason — a mutable timestamp would
 * suggest the record can be corrected, and a correctable audit trail is not one.
 */
export interface AuditEvent extends AuditFields {
  /**
   * `idempotencyKey` when `log.audit()` derived one, so a delivery retried across drains lands on
   * the key it already wrote rather than appending a second copy of the same action.
   */
  id: string;
  /** ISO-8601, so keys built from it sort chronologically as plain strings. */
  occurredAt: string;
}

export interface AuditLogPage {
  events: AuditEvent[];
  /** Pass back as `cursor` to read the next (older) page; null when the log is exhausted. */
  nextCursor: string | null;
}

export interface AuditLogStore {
  append(event: AuditEvent): Promise<void>;
  /** Newest first. */
  list(options?: AuditLogQuery): Promise<AuditLogPage>;
}

export interface AuditLogQuery {
  limit?: number;
  cursor?: string;
}

const AUDIT_PREFIX = 'audit:';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Audit records persisted through the same provider-neutral storage layer as task history.
 *
 * The storage key is `audit:<occurredAt>:<id>`. The timestamp leads so keys sort chronologically
 * as strings and a page can be taken without loading the whole log; the id follows so two records
 * minted in the same millisecond get distinct keys. Together they also make the store append-only
 * by construction rather than by convention: no key is ever derived from data a later write could
 * repeat, so nothing here can overwrite an existing record, and the contract exposes no update or
 * delete at all.
 */
export class PersistentAuditLogStore implements AuditLogStore {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly secrets: readonly string[] = secretValuesFromEnvironment(),
  ) {}

  async append(event: AuditEvent): Promise<void> {
    const key = auditStorageKey(event);
    const value = sanitizeEvent(event, this.secrets);
    // Append-only is enforced at the write, not just assumed from the key shape. A driver with a
    // conditional create makes it atomic; one without gets the read-then-write claim, which is
    // racy in principle but bounded in practice — a collision needs the same minted id inside the
    // same millisecond, which is a repeated UUID. Either way an existing record stands: the first
    // write of a key is the one the trail keeps.
    if (this.storage.setItemIfAbsent) {
      await this.storage.setItemIfAbsent(key, value);
      return;
    }
    const existing = await this.storage.getItem(key);
    if (existing !== null && existing !== undefined) return;
    await this.storage.setItem(key, value);
  }

  async list(options: AuditLogQuery = {}): Promise<AuditLogPage> {
    const limit = pageSize(options.limit);
    // `getKeys` still enumerates every audit key, which is the honest limit of a KV backend with
    // no range scan. Only the requested page is hydrated, so the expensive part stays bounded;
    // if the log ever outgrows key enumeration, an indexed store is the answer, not a bigger page.
    const keys = (await this.storage.getKeys(AUDIT_PREFIX)).toSorted().toReversed();
    // The cursor is the storage key of the last record served, so the next page starts strictly
    // after it. An unknown cursor yields -1 + 1 = 0, restarting from the newest record rather
    // than failing: a stale cursor is a client that fell behind, not an error worth a 4xx.
    const start = options.cursor ? keys.indexOf(options.cursor) + 1 : 0;
    const page = keys.slice(start, start + limit);
    const records = await Promise.all(page.map((key) => this.storage.getItem(key)));
    return {
      events: records.map(migrateLegacyActor).filter(isAuditEvent),
      nextCursor: start + limit < keys.length ? (page.at(-1) ?? null) : null,
    };
  }
}

/** In-memory adapter used by embedded callers and tests; production routes use storage. */
export class MemoryAuditLogStore implements AuditLogStore {
  readonly records: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    // Same append-only rule as the persistent store, so a test that passes against this adapter
    // says something about the one production runs.
    const key = auditStorageKey(event);
    if (this.records.some((existing) => auditStorageKey(existing) === key)) return;
    this.records.push(structuredClone(event));
  }

  async list(options: AuditLogQuery = {}): Promise<AuditLogPage> {
    const limit = pageSize(options.limit);
    const ordered = this.records
      .map((event) => ({ key: auditStorageKey(event), event }))
      .toSorted((left, right) => right.key.localeCompare(left.key));
    const start = options.cursor
      ? ordered.findIndex((entry) => entry.key === options.cursor) + 1
      : 0;
    const page = ordered.slice(start, start + limit);
    return {
      events: page.map((entry) => structuredClone(entry.event)),
      nextCursor: start + limit < ordered.length ? (page.at(-1)?.key ?? null) : null,
    };
  }
}

export interface AuditLogPipelineOptions {
  /** Where drained audit records are appended. */
  store: AuditLogStore;
  /** Injectable clock and identity, so tests assert exact records instead of ignoring them. */
  now?: () => string;
  id?: () => string;
  /** Observes a failed durable write; the wide event carries the action either way. */
  onError?: (error: unknown) => void;
}

/**
 * The evlog plugins that turn `log.audit()` into a durable, readable trail.
 *
 * Handed to `EvlogHandlerPlugin`'s `plugins` option by each transport, rather than to its `drain`
 * option: a plugin drain runs *alongside* the handler's own drain, so the request line a
 * deployment already ships to stdout or an aggregator is untouched by adding this.
 *
 * Two plugins, in the order they run:
 *
 * 1. {@link auditEnricher} fills `audit.context` (requestId, traceId, ip, user agent) from the
 *    request the action happened on. A trail that says who did what is worth more when it also
 *    says from where, and none of it is something a call site should have to pass by hand.
 * 2. {@link auditOnly} filters every wide event that carries no `audit` field, so ordinary request
 *    lines never reach the trail, and awaits the append so the record is flushed before the
 *    request resolves — an audited mutation that answered 200 must not lose its record to a
 *    process that exited first.
 *
 * The durable write still fails open. By the time a drain runs, the mutation it describes has
 * already committed and the response is already decided; throwing here would turn a completed
 * action into a crash rather than un-doing anything. The loss is not silent — it reaches
 * {@link AuditLogPipelineOptions.onError}.
 */
export function auditLogPlugins(options: AuditLogPipelineOptions): EvlogPlugin[] {
  return [
    enricherPlugin('code-zero-audit-context', auditEnricher()),
    drainPlugin('code-zero-audit-log', auditOnly(auditLogDrain(options), { await: true })),
  ];
}

/**
 * The drain that appends one wide event's audit fields to the log.
 *
 * Exported for tests and for a composition root that wires its own pipeline; ordinary callers take
 * {@link auditLogPlugins}, which is this wrapped in the filter and the enricher it expects.
 */
export function auditLogDrain(options: AuditLogPipelineOptions): DrainFn {
  const timestamp = options.now ?? now;
  const identifier = options.id ?? (() => `audit_${randomUUID()}`);
  return async ({ event }) => {
    // `auditOnly` already filters these out, but a drain that assumes its wrapper is a drain that
    // writes junk the first time someone composes it differently.
    const fields = event.audit;
    if (!fields) return;
    const record: AuditEvent = {
      ...fields,
      // A retried delivery re-derives the same idempotency key, and the store refuses to overwrite
      // an existing one, so the retry is a no-op rather than a duplicate line in the trail.
      id: fields.idempotencyKey ?? identifier(),
      // The wide event's own timestamp, so the trail agrees with the request line it came from.
      occurredAt: typeof event.timestamp === 'string' ? event.timestamp : timestamp(),
    };
    try {
      await options.store.append(record);
    } catch (error) {
      // The observer is a courtesy, not a second chance to fail: a throwing `onError` would reject
      // the drain and, with `await: true`, surface as a failure on a request whose mutation had
      // already committed — the exact outcome failing open exists to prevent.
      try {
        options.onError?.(error);
      } catch {
        // Nothing left to report it to.
      }
    }
  };
}

function auditStorageKey(event: AuditEvent): string {
  return `${AUDIT_PREFIX}${event.occurredAt}:${event.id}`;
}

function pageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE);
}

function sanitizeEvent(event: AuditEvent, secrets: readonly string[]): AuditEvent {
  const serialized = JSON.stringify(event, (_key, entry: unknown) =>
    typeof entry === 'string' ? redactSecrets(entry, secrets) : entry,
  );
  const value = JSON.parse(serialized) as unknown;
  if (!isAuditEvent(value)) throw new Error('Refusing to persist an invalid audit record');
  return value;
}

const ACTOR_TYPES = new Set<string>(['user', 'system', 'api', 'agent']);
const OUTCOMES = new Set<string>(['success', 'denied', 'failure']);

/**
 * The actor kind this trail recorded before it moved onto evlog's `{ type, id }` vocabulary,
 * mapped to the closest type in the new one. `principal` was the machine-token actor the router
 * now calls `api`; `user` is unchanged; `webhook` and `system` were never actually written by any
 * caller in this codebase, but are handled all the same since the type they came from allowed them.
 */
const LEGACY_ACTOR_KINDS: Record<string, string> = {
  principal: 'api',
  user: 'user',
  webhook: 'system',
  system: 'system',
};

/**
 * Reshapes a record written before the actor moved onto evlog's `{ type, id }` vocabulary into
 * that shape, so a deployment upgrading past that change keeps reading its own history.
 *
 * Applied only when reading: `append` still refuses anything but the current shape, so nothing
 * new is ever written in the old one. Without this, `isAuditEvent` below would reject every
 * pre-existing record — `{ kind, name }` has neither field its `isAuditActor` check looks for —
 * and an append-only trail silently losing history it already has is worse than one that takes a
 * moment longer to read it.
 */
function migrateLegacyActor(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const actor = value.actor;
  if (!isRecord(actor) || typeof actor.type === 'string') return value;
  const { kind, name } = actor;
  if (typeof kind !== 'string' || typeof name !== 'string') return value;
  const type = LEGACY_ACTOR_KINDS[kind];
  if (!type) return value;
  return { ...value, actor: { type, id: name } };
}

/**
 * The full shape, not just the field names.
 *
 * `list` returns whatever survives this predicate as an {@link AuditEvent}, so a check that only
 * asks whether `outcome` is a string would hand a reader an `outcome` no renderer has a branch
 * for. The unions and the nested objects are validated exactly. Everything evlog may add beyond
 * them — `changes`, `context`, the signing fields — is left unvalidated on purpose: it is
 * evlog's schema to evolve, and a predicate that rejected a field this version has not heard of
 * would drop records rather than render them.
 */
function isAuditEvent(value: unknown): value is AuditEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.occurredAt === 'string' &&
    typeof value.action === 'string' &&
    typeof value.outcome === 'string' &&
    OUTCOMES.has(value.outcome) &&
    isAuditActor(value.actor) &&
    isAuditTarget(value.target)
  );
}

function isAuditActor(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    ACTOR_TYPES.has(value.type) &&
    typeof value.id === 'string'
  );
}

function isAuditTarget(value: unknown): boolean {
  if (value === undefined) return true;
  return isRecord(value) && typeof value.type === 'string' && typeof value.id === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
