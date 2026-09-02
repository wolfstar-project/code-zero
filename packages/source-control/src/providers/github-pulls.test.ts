import { describe, expect, it } from 'vitest';

import { GitHubPullRequests, isSafeBranchName } from './github-pulls.js';

interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

function fakeGitHub(
  responses: Record<string, unknown>,
  failWith?: { path: string; status: number; body: string },
): { fetch: typeof globalThis.fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const handler: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(
      typeof input === 'string' ? input : 'url' in input ? input.url : input.href,
    ).pathname;
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({
      method: init?.method ?? 'GET',
      path,
      body,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    if (failWith && path === failWith.path)
      return new Response(failWith.body, { status: failWith.status });
    if (!(path in responses)) return new Response('{"message":"missing"}', { status: 404 });
    return new Response(JSON.stringify(responses[path]), { status: 200 });
  };
  return { fetch: handler, requests };
}

const target = { owner: 'acme', repo: 'app' };
const baseSha = 'b'.repeat(40);
const REDACTED_FAILURE = /^(?!.*secret-token-value).*500/s;

function adapter(
  responses: Parameters<typeof fakeGitHub>[0],
  failWith?: Parameters<typeof fakeGitHub>[1],
) {
  const github = fakeGitHub(responses, failWith);
  return {
    ...github,
    pulls: new GitHubPullRequests({ token: 'secret-token-value', fetch: github.fetch }),
  };
}

describe('isSafeBranchName', () => {
  it('accepts plain namespaced branches and refuses ref syntax', () => {
    expect(isSafeBranchName('code-zero/issue-12-cz-1')).toBe(true);
    for (const name of [
      '',
      '-lead',
      '/lead',
      'a..b',
      'a b',
      'a//b',
      'a~1',
      'a^b',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a\\b',
      'a.lock',
      'HEAD@{1}',
      `long/${'x'.repeat(300)}`,
    ])
      expect(isSafeBranchName(name)).toBe(false);
  });
});

describe('defaultBranch', () => {
  it('resolves the default branch and its head commit', async () => {
    const { pulls } = adapter({
      '/repos/acme/app': { default_branch: 'main' },
      '/repos/acme/app/git/ref/heads%2Fmain': { object: { sha: baseSha } },
    });
    await expect(pulls.defaultBranch(target)).resolves.toEqual({ name: 'main', sha: baseSha });
  });

  it('fails loudly when GitHub reports no usable commit', async () => {
    const { pulls } = adapter({
      '/repos/acme/app': { default_branch: 'main' },
      '/repos/acme/app/git/ref/heads%2Fmain': { object: { sha: 'not-a-sha!' } },
    });
    await expect(pulls.defaultBranch(target)).rejects.toThrow('did not report a commit');
  });
});

describe('publishBranch', () => {
  const responses = {
    [`/repos/acme/app/git/commits/${baseSha}`]: { tree: { sha: 't'.repeat(40) } },
    '/repos/acme/app/git/blobs': { sha: 'f'.repeat(40) },
    '/repos/acme/app/git/trees': { sha: 'e'.repeat(40) },
    '/repos/acme/app/git/commits': { sha: 'c'.repeat(40) },
    '/repos/acme/app/git/refs': { ref: 'refs/heads/code-zero/issue-12' },
  };

  it('builds the branch from base commit, byte-safe blobs, tree, commit, and a fresh ref', async () => {
    const { pulls, requests } = adapter(responses);
    // Invalid UTF-8 bytes: only a base64 blob can carry them to GitHub without corruption.
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x80]).toString('base64');
    const outcome = await pulls.publishBranch(target, {
      branch: 'code-zero/issue-12',
      baseSha,
      message: 'Guard the null return',
      files: [
        { path: 'assets/logo.png', contentBase64: binary },
        { path: 'src/stale.ts', contentBase64: null },
      ],
    });
    expect(outcome).toEqual({ commitSha: 'c'.repeat(40) });
    const blob = requests.find((request) => request.path === '/repos/acme/app/git/blobs');
    expect(blob?.body).toEqual({ content: binary, encoding: 'base64' });
    // The exact equality matters: entries reference blobs by id and never carry an inline
    // `content` field, because the tree API's text-only content field corrupts binary bytes.
    const tree = requests.find((request) => request.path === '/repos/acme/app/git/trees');
    expect(tree?.body).toEqual({
      base_tree: 't'.repeat(40),
      tree: [
        { path: 'assets/logo.png', mode: '100644', type: 'blob', sha: 'f'.repeat(40) },
        { path: 'src/stale.ts', mode: '100644', type: 'blob', sha: null },
      ],
    });
    const ref = requests.find((request) => request.path === '/repos/acme/app/git/refs');
    expect(ref?.body).toEqual({ ref: 'refs/heads/code-zero/issue-12', sha: 'c'.repeat(40) });
    for (const request of requests) expect(request.authorization).toBe('Bearer secret-token-value');
  });

  it('never force-updates an existing branch', async () => {
    const { pulls } = adapter(responses, {
      path: '/repos/acme/app/git/refs',
      status: 422,
      body: '{"message":"Reference already exists"}',
    });
    await expect(
      pulls.publishBranch(target, {
        branch: 'code-zero/issue-12',
        baseSha,
        message: 'retry',
        files: [{ path: 'src/user.ts', contentBase64: 'eA==' }],
      }),
    ).rejects.toThrow('422');
  });

  it('refuses unsafe branches, escaped paths, non-base64 content, and empty change sets before any request', async () => {
    const { pulls, requests } = adapter(responses);
    await expect(
      pulls.publishBranch(target, {
        branch: 'a..b',
        baseSha,
        message: 'm',
        files: [{ path: 'a', contentBase64: '' }],
      }),
    ).rejects.toThrow('unsafe branch name');
    await expect(
      pulls.publishBranch(target, {
        branch: 'code-zero/issue-12',
        baseSha,
        message: 'm',
        files: [{ path: '../escape', contentBase64: '' }],
      }),
    ).rejects.toThrow('not inside the repository');
    await expect(
      pulls.publishBranch(target, {
        branch: 'code-zero/issue-12',
        baseSha,
        message: 'm',
        files: [{ path: 'src/user.ts', contentBase64: 'not base64!' }],
      }),
    ).rejects.toThrow('not base64');
    await expect(
      pulls.publishBranch(target, {
        branch: 'code-zero/issue-12',
        baseSha,
        message: 'm',
        files: [],
      }),
    ).rejects.toThrow('no changed files');
    expect(requests).toEqual([]);
  });

  it('redacts the token from a failed response before raising it', async () => {
    const { pulls } = adapter(responses, {
      path: '/repos/acme/app/git/trees',
      status: 500,
      body: 'boom secret-token-value boom',
    });
    await expect(
      pulls.publishBranch(target, {
        branch: 'code-zero/issue-12',
        baseSha,
        message: 'm',
        files: [{ path: 'src/user.ts', contentBase64: 'eA==' }],
      }),
    ).rejects.toThrow(REDACTED_FAILURE);
  });
});

describe('openPullRequest', () => {
  it('opens the pull request against the base branch', async () => {
    const { pulls, requests } = adapter({
      '/repos/acme/app/pulls': {
        number: 41,
        html_url: 'https://github.com/acme/app/pull/41',
      },
    });
    const opened = await pulls.openPullRequest(target, {
      title: 'Guard the null return',
      body: 'Closes #12.',
      head: 'code-zero/issue-12',
      base: 'main',
    });
    expect(opened).toEqual({ number: 41, url: 'https://github.com/acme/app/pull/41' });
    expect(requests[0]?.body).toMatchObject({
      head: 'code-zero/issue-12',
      base: 'main',
      maintainer_can_modify: true,
    });
  });

  it('refuses to target the base branch directly', async () => {
    const { pulls, requests } = adapter({});
    await expect(
      pulls.openPullRequest(target, { title: 't', body: 'b', head: 'main', base: 'main' }),
    ).rejects.toThrow('head is its base');
    expect(requests).toEqual([]);
  });
});
