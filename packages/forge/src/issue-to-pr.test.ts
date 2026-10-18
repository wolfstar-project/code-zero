import { describe, expect, it } from 'vitest';

import { publishIssuePullRequest, type IssuePullRequestRequest } from './issue-to-pr.js';
import { issueBundle } from './test-support/evidence.js';
import { fakeForge, fakeRegistry, withCommitFiles } from './test-support/fake-forge.js';
import { replayRegistry, type ForgeFixture } from './test-support/forge-fixture.js';
import { forgeFixtures } from './test-support/forges/index.js';

const content = Buffer.from('export const user = load() ?? fallback;\n').toString('base64');

function request(
  fixture: ForgeFixture,
  overrides: Partial<IssuePullRequestRequest> = {},
): IssuePullRequestRequest {
  return {
    repository: { forge: fixture.kind, instance: fixture.instance, owner: 'acme', repo: 'app' },
    bundle: issueBundle,
    branchPrefix: 'code-zero/',
    taskIdentifier: 'cz_ABC-123',
    files: [{ path: 'src/user.ts', contentBase64: content }],
    ...overrides,
  };
}

describe.each(forgeFixtures)('publishIssuePullRequest on $kind', (fixture) => {
  it('is unsupported on the real provider, which forges 0.1 ships without commitFiles', async () => {
    const { registry, calls } = replayRegistry(fixture);
    const outcome = await publishIssuePullRequest(registry, request(fixture));
    expect(outcome).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('contents.commitFiles'),
    });
    expect(calls).toEqual([]);
  });

  it('commits to a fresh branch and opens a pull request once commitFiles exists', async () => {
    const fake = fakeForge(fixture);
    const { factory, commits } = withCommitFiles(fake);
    const outcome = await publishIssuePullRequest(
      fakeRegistry(factory, fixture.kind),
      request(fixture),
    );
    expect(outcome).toMatchObject({ status: 'opened', branch: 'code-zero/issue-9-cz-abc-123' });

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      branch: 'code-zero/issue-9-cz-abc-123',
      // The branch is created by the commit, so an existing one is never rewritten.
      createFrom: 'main',
    });
    expect(commits[0]?.message).toContain('Closes #9.');
    expect(Buffer.from(commits[0]?.changes[0]?.content ?? []).toString()).toContain('fallback');

    const opened = [...(fake.store.repos.get('acme/app')?.threads.values() ?? [])].find(
      (state) => state.thread.title === 'Guard the null return in the loader',
    );
    expect(opened?.thread.kind).toBe('pull_request');
    expect(opened?.thread.body).toContain('Closes #9.');
  });

  it('is unsupported on a read-only connection even with commitFiles', async () => {
    const { factory, commits } = withCommitFiles(fakeForge(fixture, { readOnly: true }));
    const outcome = await publishIssuePullRequest(
      fakeRegistry(factory, fixture.kind),
      request(fixture),
    );
    expect(outcome.status).toBe('unsupported');
    expect(commits).toEqual([]);
  });

  it('publishes nothing for a run that has not earned a pull request', async () => {
    const { factory, commits } = withCommitFiles(fakeForge(fixture));
    const outcome = await publishIssuePullRequest(
      fakeRegistry(factory, fixture.kind),
      request(fixture, { bundle: { ...issueBundle, verified: false } }),
    );
    expect(outcome).toMatchObject({ status: 'not-ready' });
    expect(commits).toEqual([]);
  });

  it('refuses unsafe branch names before any request', async () => {
    const { factory, commits } = withCommitFiles(fakeForge(fixture));
    const registry = fakeRegistry(factory, fixture.kind);
    for (const branchPrefix of ['../heads/', 'bad prefix ', 'code-zero/.', '-x/']) {
      await expect(
        publishIssuePullRequest(registry, request(fixture, { branchPrefix })),
      ).rejects.toThrow('unsafe branch name');
    }
    await expect(
      publishIssuePullRequest(registry, request(fixture, { base: 'main..evil' })),
    ).rejects.toThrow('unsafe branch name');
    expect(commits).toEqual([]);
  });
});

describe('publishIssuePullRequest change sets', () => {
  const [fixture] = forgeFixtures;

  it('refuses empty, escaping, or non-base64 change sets before any request', async () => {
    if (!fixture) throw new Error('missing fixture');
    const { factory, commits } = withCommitFiles(fakeForge(fixture));
    const registry = fakeRegistry(factory, fixture.kind);
    await expect(
      publishIssuePullRequest(registry, request(fixture, { files: [] })),
    ).rejects.toThrow('no changed files');
    await expect(
      publishIssuePullRequest(
        registry,
        request(fixture, { files: [{ path: '../etc/passwd', contentBase64: content }] }),
      ),
    ).rejects.toThrow('not inside the repository');
    await expect(
      publishIssuePullRequest(
        registry,
        request(fixture, { files: [{ path: 'src/user.ts', contentBase64: 'not base64!' }] }),
      ),
    ).rejects.toThrow('not base64');
    expect(commits).toEqual([]);
  });

  it('records a deletion as a null change', async () => {
    if (!fixture) throw new Error('missing fixture');
    const { factory, commits } = withCommitFiles(fakeForge(fixture));
    await publishIssuePullRequest(
      fakeRegistry(factory, fixture.kind),
      request(fixture, { files: [{ path: 'src/old.ts', contentBase64: null }] }),
    );
    expect(commits[0]?.changes).toEqual([{ path: 'src/old.ts', content: null }]);
  });
});
