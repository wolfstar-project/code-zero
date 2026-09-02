import { randomUUID } from 'node:crypto';

import { now, redactSecrets, secretValuesFromEnvironment } from '@code-zero/shared';

import type { KeyValueStorage } from './control-plane.js';
import { requestLoggerStorage } from './orpc/logging.js';

/**
 * Who performed an audited action.
 *
 * `principal` is an operator token presented by a machine caller; `user` is the
 * session-authenticated dashboard user. The router derives which one from the authenticated
 * principal's own kind, so a reader never has to guess whether an actor was a human or a token —
 * they are revoked through different channels, and the trail has to say which one to go turn off.
 */
export type AuditActorKind = 'principal' | 'user' | 'webhook' | 'system';

export interface AuditActor {
  kind: AuditActorKind;
  name: string;
}

/** Whether the audited attempt went through, was refused by policy, or failed while running. */
export type AuditOutcome = 'success' | 'denied' | 'failure';

/**
 * One audited action, appended once and never rewritten.
 *
 * The actor is denormalized onto the record rather than referenced, following the same reasoning
 * as `invite_use` in `@code-zero/database`: an audit record states who did what at a moment that
 * has already passed, and it has to keep saying so after the token is revoked or the account it
 * names is deleted. There is no `updatedAt` for the same reason — a mutable timestamp would
 * suggest the record can be corrected, and a correctable audit trail is not one.
 */
export interface AuditEvent {
  id: string;
  /** ISO-8601, so keys built from it sort chronologically as plain strings. */
  occurredAt: string;
  /**
   * Never accepted from the wire. Transports derive it from the authenticated caller, the same
   * rule `operations.ts` states for approval actors: a caller that can name itself can frame
   * somebody else.
   */
  actor: AuditActor;
  /** Dotted past-tense action, e.g. `task.created`; the attempted form for a denial. */
  action: string;
  subject?: { type: string; id: string };
  outcome: AuditOutcome;
  /**
   * Flat string map by design. Nested or non-string values would make the records awkward to
   * render in one table and, worse, would let a value through that redaction does not reach.
   */
  metadata?: Record<string, string>;
}

/** What call sites supply; the recorder mints the identity and the timestamp. */
export type AuditEntryInput = Omit<AuditEvent, 'id' | 'occurredAt'>;

export interface AuditRecorder {
  /**
   * Records one action. Never rejects: see {@link createAuditRecorder} for why an audit write
   * failure must not turn an already-committed mutation into an error response.
   */
  record(entry: AuditEntryInput): Promise<void>;
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
      events: records.filter(isAuditEvent),
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

export interface AuditRecorderOptions {
  store: AuditLogStore;
  /** Injectable clock and identity, so tests assert exact records instead of ignoring them. */
  now?: () => string;
  id?: () => string;
  /** Observes a failed durable write; the wide event carries it either way. */
  onError?: (error: unknown) => void;
}

/**
 * Builds the recorder transports inject into {@link RpcContext}.
 *
 * Every recorded action is also set on the request's evlog wide event, so one request line
 * carries the action alongside the principal and the route — the log answers "what did this
 * request change" without a join against the durable log. `getStore()` reads the
 * AsyncLocalStorage directly rather than the throwing `useLogger()`, for the same reason the
 * `authenticated` middleware does: it is `undefined` outside an active request, which is exactly
 * the case for procedures exercised through `createRouterClient` without the transport plugin.
 *
 * The durable write fails open. By the time a call site records, its mutation has already
 * committed; rejecting here would report failure for work that actually happened, which is a
 * worse lie than a missing audit line. The loss is not silent — it lands on the wide event and
 * on {@link AuditRecorderOptions.onError}.
 */
export function createAuditRecorder(options: AuditRecorderOptions): AuditRecorder {
  const timestamp = options.now ?? now;
  const identifier = options.id ?? (() => `audit_${randomUUID()}`);
  return {
    async record(entry: AuditEntryInput): Promise<void> {
      const event: AuditEvent = { id: identifier(), occurredAt: timestamp(), ...entry };
      requestLoggerStorage?.getStore()?.set({
        audit: {
          action: event.action,
          outcome: event.outcome,
          ...(event.subject ? { subject: `${event.subject.type}:${event.subject.id}` } : {}),
        },
      });
      try {
        await options.store.append(event);
      } catch (error) {
        requestLoggerStorage?.getStore()?.set({ auditWriteError: String(error) });
        // The observer is a courtesy, not a second chance to fail: a throwing `onError` would
        // reject this call and turn an already-committed mutation into an error response, which
        // is the exact outcome failing open exists to prevent.
        try {
          options.onError?.(error);
        } catch {
          requestLoggerStorage?.getStore()?.set({ auditErrorHandlerFailed: true });
        }
      }
    },
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

const ACTOR_KINDS = new Set<string>(['principal', 'user', 'webhook', 'system']);
const OUTCOMES = new Set<string>(['success', 'denied', 'failure']);

/**
 * The full shape, not just the field names.
 *
 * `list` returns whatever survives this predicate as an {@link AuditEvent}, so a check that only
 * asks whether `outcome` is a string would hand a reader an `outcome` no renderer has a branch
 * for. The unions and the optional objects are validated exactly, and `metadata` is held to the
 * flat string map its contract promises — a nested value there is also one redaction never
 * reached.
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
    isAuditSubject(value.subject) &&
    isAuditMetadata(value.metadata)
  );
}

function isAuditActor(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    ACTOR_KINDS.has(value.kind) &&
    typeof value.name === 'string'
  );
}

function isAuditSubject(value: unknown): boolean {
  if (value === undefined) return true;
  return isRecord(value) && typeof value.type === 'string' && typeof value.id === 'string';
}

function isAuditMetadata(value: unknown): boolean {
  if (value === undefined) return true;
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
