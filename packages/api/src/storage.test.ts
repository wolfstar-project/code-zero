import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { FileKeyValueStorage } from './storage.js';

const UNSAFE_KEY = /unsafe key/i;

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'code-zero-storage-'));
});

describe('FileKeyValueStorage', () => {
  it('round-trips a namespaced record', async () => {
    const storage = new FileKeyValueStorage(directory);
    await storage.setItem('tasks:cz_1', { id: 'cz_1' });
    await expect(storage.getItem('tasks:cz_1')).resolves.toEqual({ id: 'cz_1' });
    await expect(storage.getKeys('tasks:')).resolves.toEqual(['tasks:cz_1']);
  });

  it('reports a missing record as absent instead of throwing', async () => {
    await expect(
      new FileKeyValueStorage(directory).getItem('tasks:cz_missing'),
    ).resolves.toBeNull();
  });

  it('lists no keys when the directory has never been written', async () => {
    await expect(
      new FileKeyValueStorage(join(directory, 'absent')).getKeys('tasks:'),
    ).resolves.toEqual([]);
  });

  it('refuses a key that could address a path outside the store', async () => {
    const storage = new FileKeyValueStorage(directory);
    await expect(storage.setItem('../escape', {})).rejects.toThrow(UNSAFE_KEY);
    await expect(storage.getItem('tasks:../../etc/passwd')).rejects.toThrow(UNSAFE_KEY);
    await expect(storage.getKeys('tasks:')).resolves.toEqual([]);
  });

  it('grants a conditional write to exactly one claimant and preserves the winner', async () => {
    const storage = new FileKeyValueStorage(directory);
    await expect(storage.setItemIfAbsent('deliveries:abc', { claimedAt: 'first' })).resolves.toBe(
      true,
    );
    await expect(storage.setItemIfAbsent('deliveries:abc', { claimedAt: 'second' })).resolves.toBe(
      false,
    );
    await expect(storage.getItem('deliveries:abc')).resolves.toEqual({ claimedAt: 'first' });
  });

  it('removes a record without disturbing its siblings', async () => {
    const storage = new FileKeyValueStorage(directory);
    await storage.setItem('tasks:cz_1', { id: 'cz_1' });
    await storage.setItem('tasks:cz_2', { id: 'cz_2' });
    await storage.removeItem('tasks:cz_1');
    await expect(storage.getKeys('tasks:')).resolves.toEqual(['tasks:cz_2']);
  });
});
