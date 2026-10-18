import { fake } from 'forges/fake';
import { describe, expect, it } from 'vitest';

import { listOpenChangeRequests } from './discovery.js';
import { fakeRegistry } from './test-support/fake-forge.js';
import { BASE, HEAD } from './test-support/forge-fixture.js';

const target = { forge: 'gitlab' as const, instance: 'fake.test', owner: 'acme', repo: 'app' };

function seeded(count: number) {
  const factory = fake({
    forge: 'gitlab',
    seed: {
      repos: [{ repo: 'acme/app' }],
      threads: Array.from({ length: count }, (_unused, index) => ({
        repo: 'acme/app',
        kind: 'pull_request' as const,
        number: index + 1,
        title: `Change ${String(index + 1)}`,
        isDraft: index === 0,
      })),
    },
  });
  // The fake reports no branches; a forge's listing does, so the test gives every one a head.
  for (const state of factory.store.repos.get('acme/app')?.threads.values() ?? [])
    state.thread.branches = {
      head: { ref: `feat-${state.thread.ref.number ?? ''}`, sha: HEAD },
      base: { ref: 'main', sha: BASE },
    };
  return factory;
}

describe('listOpenChangeRequests', () => {
  it('lists every open change request with the commits a review needs', async () => {
    const result = await listOpenChangeRequests(fakeRegistry(seeded(3), 'gitlab'), target, {
      perPage: 2,
    });
    expect(result.truncated).toBe(false);
    expect(
      result.changeRequests.map((change) => change.number).toSorted((left, right) => left - right),
    ).toEqual([1, 2, 3]);
    expect(result.changeRequests[0]).toMatchObject({ headSha: HEAD, baseSha: BASE });
    expect(result.changeRequests.find((change) => change.number === 1)?.draft).toBe(true);
  });

  it('stops at the page limit and says the listing was cut short', async () => {
    const result = await listOpenChangeRequests(fakeRegistry(seeded(5), 'gitlab'), target, {
      perPage: 2,
      maxPages: 2,
    });
    expect(result.changeRequests).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });

  it('skips a record without a commit-shaped head instead of failing the page', async () => {
    const factory = seeded(2);
    const broken = factory.store.repos.get('acme/app')?.threads.get('2');
    if (broken)
      broken.thread.branches = { head: { ref: 'feat', sha: 'not-a-sha' }, base: { ref: 'main' } };
    const result = await listOpenChangeRequests(fakeRegistry(factory, 'gitlab'), target);
    expect(result.changeRequests.map((change) => change.number)).toEqual([1]);
  });

  it('refuses a connection that cannot list change requests, and a bad page limit', async () => {
    const factory = fake({ forge: 'gitlab', support: { 'threads.list': false } });
    await expect(listOpenChangeRequests(fakeRegistry(factory, 'gitlab'), target)).rejects.toThrow(
      'cannot list change requests',
    );
    await expect(
      listOpenChangeRequests(fakeRegistry(seeded(1), 'gitlab'), target, { maxPages: 0 }),
    ).rejects.toThrow('positive integer');
  });
});
