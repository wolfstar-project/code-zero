import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { memoryRepositoryStore } from '../../server/utils/repositories.js';

const CHECKOUT = resolve('/srv/widget');

describe('memoryRepositoryStore', () => {
  it('starts empty, so nothing is allow-listed until it is saved', async () => {
    const store = memoryRepositoryStore();

    expect(await store.list()).toEqual([]);
    expect(await store.allows(CHECKOUT)).toBe(false);
  });

  it('watches a saved repository with coordinates and polling on, and only allow-lists a bare path', async () => {
    const store = memoryRepositoryStore();

    await store.save({ owner: 'acme', name: 'widget', checkoutPath: CHECKOUT, pollEnabled: true });
    await store.save({ checkoutPath: resolve('/srv/other') });

    expect(await store.allows(CHECKOUT)).toBe(true);
    expect(await store.allows(resolve('/srv/other'))).toBe(true);
    expect((await store.watched()).map((record) => `${record.owner}/${record.name}`)).toEqual([
      'acme/widget',
    ]);
  });

  it('keeps the fields a save leaves out, the way the Postgres upsert does', async () => {
    const store = memoryRepositoryStore();
    await store.save({ owner: 'acme', name: 'widget', checkoutPath: CHECKOUT, pollEnabled: true });

    const saved = await store.save({ checkoutPath: CHECKOUT });

    // A save naming only the path corrects the path: it must not demote a watched repository to an
    // unwatched one with no coordinates, which is what the poller reads `watched()` for.
    expect(saved).toMatchObject({
      provider: 'github',
      owner: 'acme',
      name: 'widget',
      checkoutPath: CHECKOUT,
      pollEnabled: true,
    });
    expect(await store.list()).toHaveLength(1);
    expect((await store.watched()).map((record) => record.checkoutPath)).toEqual([CHECKOUT]);
  });

  it('writes the fields a save does name, and defaults them for a repository it has never seen', async () => {
    const store = memoryRepositoryStore();
    await store.save({ owner: 'acme', name: 'widget', checkoutPath: CHECKOUT, pollEnabled: true });

    const updated = await store.save({
      checkoutPath: CHECKOUT,
      mode: 'suggest',
      pollEnabled: false,
    });
    expect(updated).toMatchObject({ owner: 'acme', mode: 'suggest', pollEnabled: false });

    const created = await store.save({ checkoutPath: resolve('/srv/fresh') });
    expect(created).toMatchObject({
      provider: 'github',
      owner: null,
      name: null,
      mode: 'observe',
      pollEnabled: false,
    });
  });

  it('removes a record by id', async () => {
    const store = memoryRepositoryStore();
    const saved = await store.save({ checkoutPath: CHECKOUT });

    expect(await store.remove(saved.id)).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(await store.remove(saved.id)).toBe(false);
  });
});
