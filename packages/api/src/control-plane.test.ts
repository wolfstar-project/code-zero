import { describe, expect, it } from 'vitest';

import {
  MemoryTaskStore,
  PersistentDeliveryClaimStore,
  PersistentTaskStore,
  TaskQueueQuotaError,
  TaskScheduler,
  type KeyValueStorage,
  type StoredTask,
} from './control-plane.js';

function record(id: string, summary = 'safe'): StoredTask {
  return {
    id,
    repository: 'acme/app',
    status: 'queued',
    createdAt: '2026-08-09T10:00:00.000Z',
    updatedAt: '2026-08-09T10:00:00.000Z',
    events: [],
    ...(summary === 'safe'
      ? {}
      : {
          approval: {
            decision: 'approved' as const,
            actor: 'operator',
            comment: summary,
            decidedAt: '2026-08-09T10:00:00.000Z',
          },
        }),
  };
}

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
  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

/** A driver that offers the atomic conditional write; the base class exercises the fallback. */
class AtomicRecordingStorage extends RecordingStorage {
  async setItemIfAbsent(key: string, value: unknown): Promise<boolean> {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }
}

/**
 * A conditional-write-less driver that holds the first `contenders` absence checks at a barrier,
 * so every contender observes the key absent before any of them writes — the exact interleaving
 * a naive read-then-write claim resolves by granting the delivery to all of them.
 */
class RacingStorage extends RecordingStorage {
  private waiting: (() => void)[] = [];
  private held = 0;
  constructor(private readonly contenders: number) {
    super();
  }

  override async getItem(key: string): Promise<unknown> {
    if (this.held < this.contenders && !this.values.has(key)) {
      this.held += 1;
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        if (this.waiting.length >= this.contenders) for (const release of this.waiting) release();
      });
    }
    return super.getItem(key);
  }
}

/**
 * Parks the first delivery-marker write until released: the parked contender has already observed
 * the delivery absent, and it resumes (overwriting the winner's marker and reading back) only
 * after another contender claimed end to end. `parked` resolves once the contender is stalled.
 */
class ParkedWriteStorage extends RecordingStorage {
  private resolveParked!: () => void;
  readonly parked = new Promise<void>((resolve) => {
    this.resolveParked = resolve;
  });
  private releaseGate!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });
  private held = false;

  release(): void {
    this.releaseGate();
  }

  override async setItem(key: string, value: unknown): Promise<void> {
    if (!this.held && key.startsWith('deliveries:') && !key.endsWith(':contender')) {
      this.held = true;
      this.resolveParked();
      await this.gate;
    }
    await super.setItem(key, value);
  }
}

describe('task persistence', () => {
  it('round-trips structured history through a provider-neutral store', async () => {
    const storage = new RecordingStorage();
    const store = new PersistentTaskStore(storage);
    await store.save(record('cz_1'));
    await expect(store.get('cz_1')).resolves.toMatchObject({ id: 'cz_1', status: 'queued' });
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it('redacts credentials before persistence', async () => {
    const storage = new RecordingStorage();
    const store = new PersistentTaskStore(storage, ['provider-secret-value']);
    await store.save(record('cz_1', 'token=provider-secret-value'));
    expect(JSON.stringify(storage.values.get('tasks:cz_1'))).not.toContain('provider-secret-value');
    await expect(store.get('cz_1')).resolves.toMatchObject({
      approval: { comment: 'token=[redacted]' },
    });
  });

  it('keeps in-memory records isolated from caller mutation', async () => {
    const store = new MemoryTaskStore();
    const task = record('cz_1');
    await store.save(task);
    task.status = 'failed';
    await expect(store.get('cz_1')).resolves.toMatchObject({ status: 'queued' });
  });
});

describe('PersistentDeliveryClaimStore', () => {
  for (const [driver, storage] of [
    ['a conditional-write driver', () => new AtomicRecordingStorage()],
    ['the splitter fallback', () => new RecordingStorage()],
  ] as const) {
    it(`grants a claim exactly once and replays the completed outcome via ${driver}`, async () => {
      const store = new PersistentDeliveryClaimStore(storage(), []);
      await expect(store.claim('delivery:guid-1')).resolves.toEqual({ claimed: true });
      // The claim is standing but unfinished, so there is no outcome to replay yet.
      await expect(store.claim('delivery:guid-1')).resolves.toEqual({
        claimed: false,
        outcome: null,
      });
      await store.complete('delivery:guid-1', { status: 'ignored', reason: 'recorded' });
      await expect(store.claim('delivery:guid-1')).resolves.toEqual({
        claimed: false,
        outcome: { status: 'ignored', reason: 'recorded' },
      });
    });
  }

  it('grants exactly one claim when concurrent contenders both observe the key absent', async () => {
    // Two instances race the fallback: both absence checks return null before either write lands.
    // The splitter must grant at most one of them the delivery, never both.
    const store = new PersistentDeliveryClaimStore(new RacingStorage(2), []);
    const outcomes = await Promise.all([
      store.claim('delivery:guid-race'),
      store.claim('delivery:guid-race'),
    ]);
    expect(outcomes.filter((outcome) => outcome.claimed)).toHaveLength(1);
  });

  it('refuses the contender whose marker write lands after the winner already claimed', async () => {
    // The schedule write-then-read arbitration resolved by granting BOTH contenders: one
    // contender observes the delivery absent and stalls before its marker write, the winner
    // claims end to end, and only then does the stalled contender overwrite the winner's marker
    // and read back. The splitter's contender register makes the late writer lose instead.
    const storage = new ParkedWriteStorage();
    const store = new PersistentDeliveryClaimStore(storage, []);
    const late = store.claim('delivery:guid-race');
    await storage.parked;
    await expect(store.claim('delivery:guid-race')).resolves.toEqual({ claimed: true });
    storage.release();
    await expect(late).resolves.toEqual({ claimed: false, outcome: null });
  });

  it('keeps distinct deliveries independent', async () => {
    const store = new PersistentDeliveryClaimStore(new AtomicRecordingStorage(), []);
    await expect(store.claim('delivery:guid-1')).resolves.toEqual({ claimed: true });
    await expect(store.claim('delivery:guid-2')).resolves.toEqual({ claimed: true });
  });

  it('releases an unfinished claim so a redelivery may retry', async () => {
    const store = new PersistentDeliveryClaimStore(new AtomicRecordingStorage(), []);
    await expect(store.claim('delivery:guid-1')).resolves.toEqual({ claimed: true });
    await store.release('delivery:guid-1');
    await expect(store.claim('delivery:guid-1')).resolves.toEqual({ claimed: true });
  });

  it('redacts credentials before an outcome is persisted', async () => {
    const storage = new AtomicRecordingStorage();
    const store = new PersistentDeliveryClaimStore(storage, ['provider-secret-value']);
    await store.claim('delivery:guid-1');
    await store.complete('delivery:guid-1', {
      status: 'rejected',
      reason: 'token=provider-secret-value',
    });
    expect(JSON.stringify([...storage.values.values()])).not.toContain('provider-secret-value');
    await expect(store.claim('delivery:guid-1')).resolves.toEqual({
      claimed: false,
      outcome: { status: 'rejected', reason: 'token=[redacted]' },
    });
  });
});

describe('TaskScheduler', () => {
  it('enforces global and repository concurrency while draining FIFO work', async () => {
    const scheduler = new TaskScheduler({
      maxConcurrent: 2,
      maxQueued: 3,
      maxConcurrentPerRepository: 1,
    });
    const releases: Array<() => void> = [];
    const work = (value: number) =>
      scheduler.schedule(
        'acme/app',
        () => new Promise<number>((resolve) => releases.push(() => resolve(value))),
      );
    const first = work(1);
    const second = work(2);
    expect(scheduler.snapshot()).toEqual({ active: 1, queued: 1, capacity: 2 });
    releases.shift()?.();
    await expect(first).resolves.toBe(1);
    await Promise.resolve();
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 0 });
    releases.shift()?.();
    await expect(second).resolves.toBe(2);
  });

  it('rejects work after the bounded queue is full', () => {
    const scheduler = new TaskScheduler({
      maxConcurrent: 1,
      maxQueued: 1,
      maxConcurrentPerRepository: 1,
    });
    void scheduler.schedule('one', () => new Promise(() => undefined));
    void scheduler.schedule('two', () => new Promise(() => undefined));
    expect(() => scheduler.schedule('three', async () => 3)).toThrow(TaskQueueQuotaError);
  });

  it('enforces the queue limit for repository-blocked work even with free global capacity', () => {
    const scheduler = new TaskScheduler({
      maxConcurrent: 4,
      maxQueued: 1,
      maxConcurrentPerRepository: 1,
    });
    void scheduler.schedule('acme/app', () => new Promise(() => undefined));
    void scheduler.schedule('acme/app', () => new Promise(() => undefined));
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 1 });
    expect(() => scheduler.schedule('acme/app', async () => 3)).toThrow(TaskQueueQuotaError);
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 1 });
  });

  it('still starts immediately runnable work while the queue holds only blocked jobs', async () => {
    const scheduler = new TaskScheduler({
      maxConcurrent: 4,
      maxQueued: 1,
      maxConcurrentPerRepository: 1,
    });
    void scheduler.schedule('acme/app', () => new Promise(() => undefined));
    void scheduler.schedule('acme/app', () => new Promise(() => undefined));
    await expect(scheduler.schedule('acme/site', async () => 'ran')).resolves.toBe('ran');
    expect(scheduler.snapshot()).toMatchObject({ queued: 1 });
  });
});
