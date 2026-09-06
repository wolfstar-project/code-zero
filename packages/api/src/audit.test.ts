import type { AuditFields, DrainContext } from 'evlog';
import { describe, expect, it } from 'vitest';

import {
  auditLogDrain,
  MemoryAuditLogStore,
  PersistentAuditLogStore,
  type AuditEvent,
  type AuditLogStore,
} from './audit.js';
import type { KeyValueStorage } from './control-plane.js';

/** The same shape `control-plane.test.ts` uses; it is a test double, not exported production code. */
class RecordingStorage implements KeyValueStorage {
  readonly values = new Map<string, unknown>();
  async getItem(key: string): Promise<unknown> {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
  async getKeys(base = ''): Promise<string[]> {
    return [...this.values.keys()].filter((key) => key.startsWith(base));
  }
}

/** A driver that does expose a conditional create, like the KV-backed one in `storage.ts`. */
class ConditionalStorage extends RecordingStorage {
  async setItemIfAbsent(key: string, value: unknown): Promise<boolean> {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }
}

function event(id: string, occurredAt: string, overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id,
    occurredAt,
    actor: { type: 'api', id: 'release-manager' },
    action: 'task.created',
    outcome: 'success',
    ...overrides,
  };
}

/** `exactOptionalPropertyTypes` rejects an explicit `undefined`, so an absent cursor is omitted. */
function cursorOf(cursor: string | null): { cursor?: string } {
  return cursor ? { cursor } : {};
}

/** Fixed instants, never a wall clock: the ordering assertions below are the point of the test. */
const FIRST = '2026-08-09T10:00:00.000Z';
const SECOND = '2026-08-09T10:00:01.000Z';
const THIRD = '2026-08-09T10:00:02.000Z';

describe.each([
  ['PersistentAuditLogStore', () => new PersistentAuditLogStore(new RecordingStorage())],
  ['MemoryAuditLogStore', () => new MemoryAuditLogStore()],
])('%s', (_name, create) => {
  it('lists appended records newest first', async () => {
    const store: AuditLogStore = create();
    // Appended out of order, so the result proves a sort rather than an insertion order.
    await store.append(event('audit_2', SECOND));
    await store.append(event('audit_1', FIRST));
    await store.append(event('audit_3', THIRD));

    const page = await store.list();

    expect(page.events.map((entry) => entry.id)).toEqual(['audit_3', 'audit_2', 'audit_1']);
    expect(page.nextCursor).toBeNull();
  });

  it('walks the whole log through the cursor without repeating or dropping a record', async () => {
    const store: AuditLogStore = create();
    const instants = [FIRST, SECOND, THIRD, '2026-08-09T10:00:03.000Z', '2026-08-09T10:00:04.000Z'];
    for (const [index, occurredAt] of instants.entries())
      await store.append(event(`audit_${index + 1}`, occurredAt));

    const first = await store.list({ limit: 2 });
    const second = await store.list({ limit: 2, ...cursorOf(first.nextCursor) });
    const third = await store.list({ limit: 2, ...cursorOf(second.nextCursor) });

    expect(first.events.map((entry) => entry.id)).toEqual(['audit_5', 'audit_4']);
    expect(second.events.map((entry) => entry.id)).toEqual(['audit_3', 'audit_2']);
    expect(third.events.map((entry) => entry.id)).toEqual(['audit_1']);
    expect(third.nextCursor).toBeNull();
  });

  it('restarts from the newest record when the cursor is unknown', async () => {
    const store: AuditLogStore = create();
    await store.append(event('audit_1', FIRST));

    // A client that fell behind a truncated or rotated log gets the newest page, not an error.
    await expect(store.list({ cursor: 'audit:1999-01-01T00:00:00.000Z:gone' })).resolves.toEqual({
      events: [event('audit_1', FIRST)],
      nextCursor: null,
    });
  });

  it('keeps the first record written under a key, never the later one', async () => {
    const store: AuditLogStore = create();
    await store.append(event('audit_1', FIRST, { action: 'task.created' }));

    // Same id and instant, so the key repeats: a replayed delivery, or a caller minting its own
    // identifiers. An audit trail that lets the second write win is not append-only.
    await store.append(event('audit_1', FIRST, { action: 'task.deleted' }));

    const page = await store.list();
    expect(page.events).toEqual([event('audit_1', FIRST, { action: 'task.created' })]);
  });

  it('keeps records minted in the same millisecond distinct', async () => {
    const store: AuditLogStore = create();
    await store.append(event('audit_1', FIRST));
    await store.append(event('audit_2', FIRST));

    const page = await store.list();

    expect(page.events.map((entry) => entry.id).toSorted()).toEqual(['audit_1', 'audit_2']);
  });
});

describe('audit persistence', () => {
  it('redacts secrets carried in the reason before the record reaches storage', async () => {
    const storage = new RecordingStorage();
    const store = new PersistentAuditLogStore(storage, ['ghp_supersecret']);

    await store.append(event('audit_1', FIRST, { reason: 'token ghp_supersecret rejected' }));

    const [persisted] = [...storage.values.values()];
    expect(JSON.stringify(persisted)).not.toContain('ghp_supersecret');
    const page = await store.list();
    expect(page.events[0]?.reason).toBe('token [redacted] rejected');
  });

  it('refuses to persist a record that is not an audit event', async () => {
    const store = new PersistentAuditLogStore(new RecordingStorage());
    // The guard exists for callers the type system does not reach — a replayed record, a future
    // bridge deserialising one — so the test has to arrive the way they would.
    // oxlint-disable-next-line no-unsafe-type-assertion -- deliberately invalid input under test
    const malformed = { id: 'audit_1' } as AuditEvent;

    await expect(store.append(malformed)).rejects.toThrow(
      'Refusing to persist an invalid audit record',
    );
  });

  it('claims the key through the conditional create when the driver has one', async () => {
    const storage = new ConditionalStorage();
    const store = new PersistentAuditLogStore(storage);
    await store.append(event('audit_1', FIRST, { action: 'task.created' }));

    await store.append(event('audit_1', FIRST, { action: 'task.deleted' }));

    // Asserted through the driver rather than through `list`, so the atomic path is what is
    // covered here and not the read-then-write fallback the shared suite already exercises.
    expect(storage.values.get(`audit:${FIRST}:audit_1`)).toMatchObject({ action: 'task.created' });
  });

  it.each([
    ['an outcome outside the union', { outcome: 'approved' }],
    ['an actor type outside the union', { actor: { type: 'admin', id: 'root' } }],
    ['an actor missing its id', { actor: { type: 'user' } }],
    ['a target missing its id', { target: { type: 'task' } }],
  ])('refuses to persist %s', async (_name, overrides) => {
    const store = new PersistentAuditLogStore(new RecordingStorage());
    // oxlint-disable-next-line no-unsafe-type-assertion -- deliberately invalid input under test
    const malformed = event('audit_1', FIRST, overrides as Partial<AuditEvent>);

    await expect(store.append(malformed)).rejects.toThrow(
      'Refusing to persist an invalid audit record',
    );
  });

  it('ignores a stored record whose union values drifted out of contract', async () => {
    const storage = new RecordingStorage();
    // Written straight past `append`, the way a replay or an older writer would have left it.
    await storage.setItem(`audit:${SECOND}:audit_2`, {
      ...event('audit_2', SECOND),
      outcome: 'approved',
    });
    const store = new PersistentAuditLogStore(storage);
    await store.append(event('audit_1', FIRST));

    const page = await store.list();

    expect(page.events.map((entry) => entry.id)).toEqual(['audit_1']);
  });

  it('reads a record written before the actor moved to evlog\'s { type, id } vocabulary', async () => {
    const storage = new RecordingStorage();
    // Written straight past `append`, the shape a pre-upgrade deployment actually left on disk.
    await storage.setItem(`audit:${FIRST}:audit_1`, {
      ...event('audit_1', FIRST),
      actor: { kind: 'principal', name: 'release-manager' },
    });
    const store = new PersistentAuditLogStore(storage);

    const page = await store.list();

    expect(page.events).toMatchObject([
      { id: 'audit_1', actor: { type: 'api', id: 'release-manager' } },
    ]);
  });

  it('ignores foreign records sharing the audit prefix', async () => {
    const storage = new RecordingStorage();
    await storage.setItem('audit:2026-08-09T10:00:00.000Z:junk', { unrelated: true });
    const store = new PersistentAuditLogStore(storage);
    await store.append(event('audit_1', FIRST));

    const page = await store.list();

    expect(page.events.map((entry) => entry.id)).toEqual(['audit_1']);
  });
});

describe('audit log drain', () => {
  const fields = {
    actor: { type: 'api', id: 'release-manager' },
    action: 'task.created',
    outcome: 'success',
    target: { type: 'task', id: 'cz_1', repository: 'acme/app', mode: 'observe' },
  } as const;

  /** The shape a drain receives: one wide event, with the audit fields `log.audit()` set on it. */
  function drained(audit?: AuditFields, timestamp?: string): DrainContext {
    return {
      event: {
        timestamp: timestamp ?? FIRST,
        level: 'info',
        service: 'app',
        environment: 'test',
        ...(audit ? { audit } : {}),
      },
    };
  }

  it('appends the audit fields the wide event carried', async () => {
    const store = new MemoryAuditLogStore();

    await auditLogDrain({ store, id: () => 'audit_1' })(drained({ ...fields }));

    expect(store.records).toEqual([{ id: 'audit_1', occurredAt: FIRST, ...fields }]);
  });

  it('takes the identity from the idempotency key, so a retried delivery appends once', async () => {
    const store = new MemoryAuditLogStore();
    const drain = auditLogDrain({ store, id: () => 'audit_unused' });
    const context = drained({ ...fields, idempotencyKey: 'ak_1' });

    await drain(context);
    await drain(context);

    expect(store.records.map((record) => record.id)).toEqual(['ak_1']);
  });

  it('ignores a wide event that carries no audit fields', async () => {
    const store = new MemoryAuditLogStore();

    await auditLogDrain({ store })(drained());

    expect(store.records).toEqual([]);
  });

  it('resolves and reports the loss when the durable write fails', async () => {
    const failures: unknown[] = [];
    const drain = auditLogDrain({
      store: failingStore(),
      onError: (error) => failures.push(error),
    });

    // The mutation this records already committed: rejecting here would fail a request whose work
    // actually happened.
    await expect(drain(drained({ ...fields }))).resolves.toBeUndefined();
    expect(String(failures[0])).toContain('storage unavailable');
  });

  it('still resolves when the failure observer itself throws', async () => {
    const drain = auditLogDrain({
      store: failingStore(),
      onError: () => {
        throw new Error('reporter unavailable');
      },
    });

    // Failing open has to survive a broken observer too, or the reporting path becomes the way a
    // committed mutation gets reported as failed.
    await expect(drain(drained({ ...fields }))).resolves.toBeUndefined();
  });
});

function failingStore(): AuditLogStore {
  return {
    async append(): Promise<void> {
      throw new Error('storage unavailable');
    },
    async list() {
      return { events: [], nextCursor: null };
    },
  };
}
