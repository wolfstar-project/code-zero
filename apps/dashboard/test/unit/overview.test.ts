import { EventEmitter } from 'node:events';

import type { StoredTask } from '@code-zero/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOverviewBroadcaster } from '../../server/utils/overview.js';

const CHANGED = 'changed';

/** A `store.list()` a test can resolve or reject on its own schedule. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createOverviewBroadcaster', () => {
  it('coalesces a burst of changes into one store read', async () => {
    let reads = 0;
    const store = { list: () => Promise.resolve<StoredTask[]>(((reads += 1), [])) };
    const changes = new EventEmitter();
    const broadcaster = createOverviewBroadcaster(store, changes, CHANGED);
    const received: unknown[] = [];
    broadcaster.subscribeOverview((overview) => received.push(overview));

    changes.emit(CHANGED);
    changes.emit(CHANGED);
    changes.emit(CHANGED);
    await vi.advanceTimersByTimeAsync(250);

    expect(reads).toBe(1);
    expect(received).toHaveLength(1);
  });

  it('shares one read across every subscribed listener', async () => {
    let reads = 0;
    const store = { list: () => Promise.resolve<StoredTask[]>(((reads += 1), [])) };
    const changes = new EventEmitter();
    const broadcaster = createOverviewBroadcaster(store, changes, CHANGED);
    let a = 0;
    let b = 0;
    broadcaster.subscribeOverview(() => {
      a += 1;
    });
    broadcaster.subscribeOverview(() => {
      b += 1;
    });

    changes.emit(CHANGED);
    await vi.advanceTimersByTimeAsync(250);

    expect(reads).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('does not start a second read while one is already in flight', async () => {
    const first = deferred<StoredTask[]>();
    const reads: number[] = [];
    const store = {
      list: () => {
        reads.push(reads.length);
        return first.promise;
      },
    };
    const changes = new EventEmitter();
    const broadcaster = createOverviewBroadcaster(store, changes, CHANGED);
    broadcaster.subscribeOverview(() => undefined);

    changes.emit(CHANGED);
    await vi.advanceTimersByTimeAsync(250);
    expect(reads).toHaveLength(1);

    // A second change arrives while the first read is still unresolved. Without the `reading`
    // guard, this would arm a second timer and start a second, overlapping read once it fires.
    changes.emit(CHANGED);
    await vi.advanceTimersByTimeAsync(250);
    expect(reads).toHaveLength(1);

    first.resolve([]);
  });

  it('does not drop a change that arrived while a read was in flight', async () => {
    const first = deferred<StoredTask[]>();
    const second = deferred<StoredTask[]>();
    const responses = [first.promise, second.promise];
    let reads = 0;
    const store = {
      list: () => {
        const response = responses[reads];
        reads += 1;
        return response ?? Promise.resolve([]);
      },
    };
    const changes = new EventEmitter();
    const broadcaster = createOverviewBroadcaster(store, changes, CHANGED);
    let received = 0;
    broadcaster.subscribeOverview(() => {
      received += 1;
    });

    changes.emit(CHANGED);
    await vi.advanceTimersByTimeAsync(250);
    expect(reads).toBe(1);

    // Arrives mid-read: not scheduled immediately, but not lost either.
    changes.emit(CHANGED);

    first.resolve([]);
    // Let the first read's `.finally` run and, seeing the change above, schedule the next one.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);

    expect(reads).toBe(2);
    second.resolve([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(received).toBe(2);
  });

  it('reports a failed read without throwing, and keeps taking later changes', async () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    let reads = 0;
    const store = {
      list: () => {
        reads += 1;
        return reads === 1 ? Promise.reject(new Error('storage unavailable')) : Promise.resolve([]);
      },
    };
    const changes = new EventEmitter();
    const broadcaster = createOverviewBroadcaster(store, changes, CHANGED);
    let received = 0;
    broadcaster.subscribeOverview(() => {
      received += 1;
    });

    try {
      changes.emit(CHANGED);
      await vi.advanceTimersByTimeAsync(250);
      expect(errors).toHaveLength(1);
      expect(received).toBe(0);

      changes.emit(CHANGED);
      await vi.advanceTimersByTimeAsync(250);
      expect(received).toBe(1);
    } finally {
      console.error = originalError;
    }
  });

  it('answers currentOverview immediately, without waiting for the debounce window', async () => {
    const store = { list: () => Promise.resolve<StoredTask[]>([]) };
    const changes = new EventEmitter();
    const broadcaster = createOverviewBroadcaster(store, changes, CHANGED);

    await expect(broadcaster.currentOverview()).resolves.toMatchObject({});
  });

  it('stops delivering to a stream once it unsubscribes', async () => {
    const store = { list: () => Promise.resolve<StoredTask[]>([]) };
    const changes = new EventEmitter();
    const broadcaster = createOverviewBroadcaster(store, changes, CHANGED);
    let received = 0;
    const unsubscribe = broadcaster.subscribeOverview(() => {
      received += 1;
    });

    changes.emit(CHANGED);
    await vi.advanceTimersByTimeAsync(250);
    expect(received).toBe(1);

    unsubscribe();
    changes.emit(CHANGED);
    await vi.advanceTimersByTimeAsync(250);
    expect(received).toBe(1);
  });
});
