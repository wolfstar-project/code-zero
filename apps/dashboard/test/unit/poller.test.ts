import type { DeliveryClaim, DeliveryClaimStore } from '@code-zero/api';
import type { OpenPullRequest } from '@code-zero/source-control';
import { describe, expect, it } from 'vitest';

import {
  pollClaimKey,
  pollOnce,
  type PollRequest,
  type WatchedRepository,
} from '../../server/utils/poller.js';

const HEAD = 'c'.repeat(40);
const BASE = 'b'.repeat(40);

const WATCHED: WatchedRepository = {
  owner: 'acme',
  name: 'app',
  checkoutPath: '/srv/checkouts/acme-app',
  mode: 'observe',
};

function pull(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    number: 412,
    title: 'Fix the sitemap',
    headSha: HEAD,
    headRef: 'fix/sitemap',
    baseSha: BASE,
    url: 'https://github.com/acme/app/pull/412',
    draft: false,
    ...overrides,
  };
}

/** The durable claim store, reduced to the in-memory behaviour the poller relies on. */
class MemoryClaims implements DeliveryClaimStore {
  readonly outcomes = new Map<string, unknown>();

  async claim(key: string): Promise<DeliveryClaim> {
    if (this.outcomes.has(key)) return { claimed: false, outcome: this.outcomes.get(key) };
    this.outcomes.set(key, null);
    return { claimed: true };
  }

  async complete(key: string, outcome: unknown): Promise<void> {
    this.outcomes.set(key, outcome);
  }

  async release(key: string): Promise<void> {
    this.outcomes.delete(key);
  }
}

function collector() {
  const started: PollRequest[] = [];
  return { started, start: async (request: PollRequest) => void started.push(request) };
}

function source(...pulls: OpenPullRequest[]) {
  return { listOpenPullRequests: async () => pulls };
}

describe('pollOnce', () => {
  it('starts one review per open pull request, against the checkout the operator named', async () => {
    const runs = collector();

    const started = await pollOnce({
      repositories: [WATCHED],
      source: source(pull()),
      claims: new MemoryClaims(),
      start: runs.start,
    });

    expect(started).toBe(1);
    expect(runs.started).toEqual([
      {
        // Never a path derived from the provider's answer; only the one that was configured.
        repository: '/srv/checkouts/acme-app',
        mode: 'observe',
        pullRequest: { owner: 'acme', repo: 'app', number: 412, baseSha: BASE, headSha: HEAD },
        source: 'poll:acme/app#412',
      },
    ]);
  });

  it('starts each run in the mode its own repository is configured with', async () => {
    const runs = collector();

    await pollOnce({
      repositories: [{ ...WATCHED, mode: 'suggest' }],
      source: source(pull()),
      claims: new MemoryClaims(),
      start: runs.start,
    });

    expect(runs.started[0]?.mode).toBe('suggest');
  });

  it('does not review the same commit twice across passes', async () => {
    const runs = collector();
    const claims = new MemoryClaims();
    const options = {
      repositories: [WATCHED],
      source: source(pull()),
      claims,
      start: runs.start,
    };

    await pollOnce(options);
    await pollOnce(options);

    expect(runs.started).toHaveLength(1);
  });

  it('reviews again once the head commit moves', async () => {
    const runs = collector();
    const claims = new MemoryClaims();

    await pollOnce({
      repositories: [WATCHED],
      source: source(pull()),
      claims,
      start: runs.start,
    });
    await pollOnce({
      repositories: [WATCHED],
      source: source(pull({ headSha: 'd'.repeat(40) })),
      claims,
      start: runs.start,
    });

    // A new push is the whole reason to look again; the claim key carries the commit for this.
    expect(runs.started.map((request) => request.pullRequest.headSha)).toEqual([
      HEAD,
      'd'.repeat(40),
    ]);
  });

  it('skips a draft, which its author has not asked anyone to read', async () => {
    const runs = collector();

    const started = await pollOnce({
      repositories: [WATCHED],
      source: source(pull({ draft: true })),
      claims: new MemoryClaims(),
      start: runs.start,
    });

    expect(started).toBe(0);
    expect(runs.started).toEqual([]);
  });

  it('retries a commit whose run failed to start, rather than losing it', async () => {
    const claims = new MemoryClaims();
    const failures: unknown[] = [];
    const failing = {
      repositories: [WATCHED],
      source: source(pull()),
      claims,
      start: () => Promise.reject(new Error('scheduler unavailable')),
      onError: (_repository: string, error: unknown) => failures.push(error),
    };

    await pollOnce(failing);
    expect(String(failures[0])).toContain('scheduler unavailable');

    // The claim was released, so the next pass gets to try the same commit again.
    const runs = collector();
    await pollOnce({ ...failing, start: runs.start, onError: undefined });
    expect(runs.started).toHaveLength(1);
  });

  it('keeps polling the other repositories when one provider fails', async () => {
    const runs = collector();
    const second = { ...WATCHED, name: 'billing', checkoutPath: '/srv/checkouts/acme-billing' };
    const failures: string[] = [];

    const started = await pollOnce({
      repositories: [WATCHED, second],
      source: {
        listOpenPullRequests: async (target) => {
          if (target.repo === 'app') throw new Error('rate limited');
          return [pull({ number: 9 })];
        },
      },
      claims: new MemoryClaims(),
      start: runs.start,
      onError: (repository) => failures.push(repository),
    });

    expect(failures).toEqual(['acme/app']);
    expect(started).toBe(1);
    expect(runs.started[0]?.source).toBe('poll:acme/billing#9');
  });

  it('does nothing at all when no repository is watched', async () => {
    const runs = collector();

    const started = await pollOnce({
      repositories: [],
      source: {
        listOpenPullRequests: () => Promise.reject(new Error('should not be asked')),
      },
      claims: new MemoryClaims(),
      start: runs.start,
    });

    expect(started).toBe(0);
  });
});

describe('pollClaimKey', () => {
  it('identifies one commit of one pull request, so a new push is a new key', () => {
    expect(pollClaimKey(WATCHED, pull())).toBe(`poll:acme/app#412@${HEAD}`);
    expect(pollClaimKey(WATCHED, pull({ headSha: 'd'.repeat(40) }))).not.toBe(
      pollClaimKey(WATCHED, pull()),
    );
  });
});
