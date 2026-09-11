import type { StoredTask, TaskStore } from '@code-zero/api';
import { describe, expect, it } from 'vitest';

import { observeWrites } from '../../server/utils/store.js';

const TASK: StoredTask = {
  id: 'cz_alpha_0001',
  repository: 'acme/checkout',
  status: 'queued',
  createdAt: '2026-08-09T09:00:00.000Z',
  updatedAt: '2026-08-09T09:00:00.000Z',
  events: [],
};

/** An in-memory stand-in, so this covers the wrapper rather than the deployment's KV driver. */
function memoryStore(): TaskStore & { readonly saved: StoredTask[] } {
  const saved: StoredTask[] = [];
  return {
    saved,
    get: (id) => Promise.resolve(saved.find((task) => task.id === id)),
    list: () => Promise.resolve([...saved]),
    save: async (task) => void saved.push(task),
  };
}

describe('observeWrites', () => {
  it('announces every write, which is what a connected board is waiting on', async () => {
    let notified = 0;
    const store = observeWrites(memoryStore(), () => {
      notified += 1;
    });

    await store.save(TASK);
    await store.save({ ...TASK, status: 'running' });

    expect(notified).toBe(2);
  });

  it('announces only after the write landed, so a listener cannot read the old state', async () => {
    const order: string[] = [];
    const store = observeWrites(
      {
        get: () => Promise.resolve(undefined),
        list: () => Promise.resolve([]),
        save: async () => {
          await Promise.resolve();
          order.push('saved');
        },
      },
      () => order.push('notified'),
    );

    await store.save(TASK);

    expect(order).toEqual(['saved', 'notified']);
  });

  it('says nothing when the write failed, because nothing changed to look at', async () => {
    let notified = 0;
    const store = observeWrites(
      {
        get: () => Promise.resolve(undefined),
        list: () => Promise.resolve([]),
        save: () => Promise.reject(new Error('storage unavailable')),
      },
      () => {
        notified += 1;
      },
    );

    await expect(store.save(TASK)).rejects.toThrow('storage unavailable');
    expect(notified).toBe(0);
  });

  it('reads straight through, so a subscriber re-reading sees what was written', async () => {
    const store = observeWrites(memoryStore(), () => undefined);

    await store.save(TASK);

    await expect(store.get(TASK.id)).resolves.toEqual(TASK);
    await expect(store.list()).resolves.toEqual([TASK]);
  });
});
