import type { CheckResult, EvidenceBundle } from '@code-zero/shared';
import { describe, expect, it } from 'vitest';

import { reviewInputFromEvent } from '../input.js';
import { checkConclusion, GitHubChecks, parseReviewEvent } from './github.js';

const repository = { name: 'app', owner: { login: 'acme' } };
const pullRequest = {
  number: 7,
  base: { sha: 'b'.repeat(40) },
  head: { sha: 'a'.repeat(40) },
};

function reviewComment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'created',
    repository,
    pull_request: pullRequest,
    comment: {
      id: 101,
      body: 'This dereferences a null return.',
      path: 'src/user.ts',
      line: 12,
      user: { login: 'alice', type: 'User' },
      ...overrides,
    },
  };
}

function review(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'submitted',
    repository,
    pull_request: pullRequest,
    review: {
      id: 202,
      body: 'Please guard the null return.',
      state: 'changes_requested',
      user: { login: 'bob', type: 'User' },
      ...overrides,
    },
  };
}

describe('parseReviewEvent for inline comments', () => {
  it('normalizes a created review comment', () => {
    const event = parseReviewEvent('pull_request_review_comment', reviewComment());
    expect(event).toEqual({
      provider: 'github',
      trigger: 'feedback',
      changeRequest: {
        provider: 'github',
        owner: 'acme',
        repo: 'app',
        number: 7,
        baseSha: 'b'.repeat(40),
        headSha: 'a'.repeat(40),
      },
      requestedChanges: false,
      items: [
        {
          id: 'review-comment:101',
          kind: 'review-comment',
          body: 'This dereferences a null return.',
          author: 'alice',
          requestedChanges: false,
          path: 'src/user.ts',
          line: 12,
        },
      ],
    });
  });

  it('ignores actions other than creation', () => {
    expect(
      parseReviewEvent('pull_request_review_comment', {
        ...reviewComment(),
        action: 'deleted',
      }),
    ).toBeNull();
  });

  it('falls back to the original line when the comment has no current line', () => {
    const event = parseReviewEvent(
      'pull_request_review_comment',
      reviewComment({ line: null, original_line: 4 }),
    );
    expect(event?.items[0]?.line).toBe(4);
  });

  it('omits a line that is not a positive integer', () => {
    const event = parseReviewEvent(
      'pull_request_review_comment',
      reviewComment({ line: 0, original_line: -3 }),
    );
    expect(event?.items[0]?.line).toBeUndefined();
  });
});

describe('parseReviewEvent for proactive pull-request changes', () => {
  it('starts a proactive review for a new or updated pull request', () => {
    for (const action of ['opened', 'reopened', 'synchronize', 'ready_for_review']) {
      const event = parseReviewEvent('pull_request', {
        action,
        repository,
        pull_request: pullRequest,
      });
      expect(event).toMatchObject({ trigger: 'proactive', items: [], requestedChanges: false });
      expect(event?.changeRequest).toMatchObject({
        baseSha: 'b'.repeat(40),
        headSha: 'a'.repeat(40),
      });
    }
  });

  it('ignores pull-request actions that do not introduce a reviewable diff', () => {
    expect(
      parseReviewEvent('pull_request', {
        action: 'closed',
        repository,
        pull_request: pullRequest,
      }),
    ).toBeNull();
  });
});

describe('parseReviewEvent for reviews', () => {
  it('ingests a request for changes and marks it as such', () => {
    const event = parseReviewEvent('pull_request_review', review());
    expect(event?.requestedChanges).toBe(true);
    expect(event?.items[0]).toMatchObject({ kind: 'review-body', author: 'bob' });
  });

  it('ingests a plain comment review without marking changes requested', () => {
    const event = parseReviewEvent('pull_request_review', review({ state: 'commented' }));
    expect(event?.requestedChanges).toBe(false);
  });

  it('produces nothing for an approval or a dismissal', () => {
    expect(parseReviewEvent('pull_request_review', review({ state: 'approved' }))).toBeNull();
    expect(parseReviewEvent('pull_request_review', review({ state: 'dismissed' }))).toBeNull();
  });

  it('produces nothing for a request for changes with no body to act on', () => {
    expect(parseReviewEvent('pull_request_review', review({ body: '   ' }))).toBeNull();
    expect(parseReviewEvent('pull_request_review', review({ body: null }))).toBeNull();
  });
});

describe('parseReviewEvent input validation', () => {
  it('rejects payloads that are not objects', () => {
    for (const payload of [null, 'text', 42, []])
      expect(parseReviewEvent('pull_request_review', payload)).toBeNull();
  });

  it('rejects an unsupported event name', () => {
    expect(parseReviewEvent('issue_comment', reviewComment())).toBeNull();
  });

  it('requires a complete pull-request reference', () => {
    for (const payload of [
      { ...review(), repository: {} },
      { ...review(), pull_request: { number: 7 } },
      { ...review(), pull_request: { number: '7', head: { sha: 'a'.repeat(40) } } },
      {
        ...review(),
        pull_request: { number: 7, base: { sha: 'b'.repeat(40) }, head: { sha: 'not-a-sha' } },
      },
    ])
      expect(parseReviewEvent('pull_request_review', payload)).toBeNull();
  });

  it('requires an author', () => {
    expect(parseReviewEvent('pull_request_review', review({ user: {} }))).toBeNull();
  });

  it('ignores its own account so a run cannot answer itself', () => {
    expect(
      parseReviewEvent('pull_request_review', review({ user: { login: 'code-zero[bot]' } }), {
        ignoreAuthors: ['Code-Zero[bot]'],
      }),
    ).toBeNull();
  });

  it('ingests AI reviewers by default and can exclude them explicitly', () => {
    const payload = review({ user: { login: 'copilot', type: 'Bot' } });
    expect(parseReviewEvent('pull_request_review', payload)).not.toBeNull();
    expect(parseReviewEvent('pull_request_review', payload, { allowBots: false })).toBeNull();
  });

  it('bounds an oversized comment body', () => {
    const event = parseReviewEvent('pull_request_review', review({ body: 'x'.repeat(20_000) }));
    expect(event?.items[0]?.body.length).toBe(8_000);
  });
});

describe('reviewInputFromEvent', () => {
  it('builds observe-mode input by default so a webhook cannot escalate itself', () => {
    const event = parseReviewEvent('pull_request_review_comment', reviewComment());
    const input = reviewInputFromEvent(event!, { checkoutPath: '/checkout' });
    expect(input.mode).toBe('observe');
    expect(input.trigger).toBe('feedback');
    expect(input.source).toBe('github:acme/app#7');
    expect(input.repository).toBe('/checkout');
    expect(input.files).toEqual(['src/user.ts']);
    expect(input.feedback).toContain('[review-comment by alice on src/user.ts:12]');
    expect(input.pullRequest).toMatchObject({ number: 7 });
  });

  it('builds proactive input without inventing reviewer feedback', () => {
    const event = parseReviewEvent('pull_request', {
      action: 'synchronize',
      repository,
      pull_request: pullRequest,
    });
    const input = reviewInputFromEvent(event!, { checkoutPath: '/checkout' });
    expect(input.trigger).toBe('proactive');
    expect(input.feedback).toBeUndefined();
    expect(input.items).toBeUndefined();
  });

  it('carries an explicitly requested mode through', () => {
    const event = parseReviewEvent('pull_request_review', review());
    expect(reviewInputFromEvent(event!, { checkoutPath: '/checkout', mode: 'fix' }).mode).toBe(
      'fix',
    );
  });

  it('drops a path that would leave the checkout', () => {
    const event = parseReviewEvent(
      'pull_request_review_comment',
      reviewComment({ path: '../../etc/passwd' }),
    );
    expect(reviewInputFromEvent(event!, { checkoutPath: '/checkout' }).files).toBeUndefined();
  });
});

const target = {
  provider: 'github' as const,
  owner: 'acme',
  repo: 'app',
  number: 7,
  baseSha: 'b'.repeat(40),
  headSha: 'a'.repeat(40),
};
const REDACTED_MARKER = /\[redacted]/;
const LEAKED_TOKEN = /ghs_token_value/;

const passing: CheckResult = {
  command: 'pnpm run test',
  exitCode: 0,
  stdout: '',
  stderr: '',
  durationMs: 5,
};
const failing: CheckResult = { ...passing, exitCode: 1, stderr: 'assertion failed' };

function bundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    taskId: 'cz_test',
    state: 'completed',
    verdict: 'accepted',
    verified: true,
    mode: 'fix',
    trigger: 'feedback',
    source: 'github:acme/app#7',
    issue: null,
    runner: { kind: 'container', isolated: true, writable: true, network: 'none' },
    finding: null,
    plan: [],
    acceptanceCriteria: [],
    changedFiles: ['src/user.ts'],
    checks: [passing],
    attempts: 1,
    transitions: [],
    summary: 'Fixed and verified',
    ...overrides,
  };
}

describe('checkConclusion', () => {
  it('reports success only for a verified run', () => {
    expect(checkConclusion(bundle())).toBe('success');
  });

  it('never reports success when a check failed', () => {
    expect(checkConclusion(bundle({ checks: [passing, failing], verified: true }))).toBe('failure');
  });

  it('reports a crashed run as a failure', () => {
    expect(checkConclusion(bundle({ state: 'failed', verified: false, checks: [] }))).toBe(
      'failure',
    );
  });

  it('asks for action when a run needs a human', () => {
    expect(checkConclusion(bundle({ state: 'needs-human', verified: false, checks: [] }))).toBe(
      'action_required',
    );
  });

  it('reports rejected feedback as neutral rather than a pull-request failure', () => {
    expect(
      checkConclusion(
        bundle({ verdict: 'rejected', verified: false, checks: [], changedFiles: [] }),
      ),
    ).toBe('neutral');
  });

  it('reports an observe-only run as neutral', () => {
    expect(
      checkConclusion(bundle({ mode: 'observe', verified: false, checks: [], changedFiles: [] })),
    ).toBe('neutral');
  });
});

/** One recorded request, already decoded so tests never stringify an unknown body. */
interface RecordedCall {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

type FetchArguments = Parameters<typeof globalThis.fetch>;

const token = 'ghs_token_value_1234567890';

function requestUrl(url: FetchArguments[0]): string {
  if (typeof url === 'string') return url;
  return url instanceof URL ? url.href : url.url;
}

function readBody(body: NonNullable<FetchArguments[1]>['body']): Record<string, unknown> {
  if (typeof body !== 'string') return {};
  const parsed: unknown = JSON.parse(body);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? { ...parsed }
    : {};
}

function created(): Response {
  return new Response(JSON.stringify({ id: 42 }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

function client(handler: () => Response = created): {
  checks: GitHubChecks;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const checks = new GitHubChecks({
    token,
    fetch: async (url, init) => {
      calls.push({
        url: requestUrl(url),
        headers: new Headers(init?.headers),
        body: readBody(init?.body),
      });
      return handler();
    },
  });
  return { checks, calls };
}

/** The check output object a completion request carries. */
function readOutput(call: RecordedCall | undefined): { title: string; text: string } {
  const output = call?.body.output;
  if (typeof output !== 'object' || output === null) throw new Error('no check output recorded');
  const record: Record<string, unknown> = { ...output };
  return {
    title: typeof record.title === 'string' ? record.title : '',
    text: typeof record.text === 'string' ? record.text : '',
  };
}

describe('GitHubChecks', () => {
  it('opens an in-progress run against the head commit', async () => {
    const { checks, calls } = client(created);
    await expect(checks.start(target)).resolves.toBe(42);
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/app/check-runs');
    expect(calls[0]?.body).toMatchObject({
      head_sha: target.headSha,
      status: 'in_progress',
      name: 'Code Zero',
    });
  });

  it('sends the token only as an authorization header', async () => {
    const { checks, calls } = client(created);
    await checks.publish(target, bundle());
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(JSON.stringify(calls[0]?.body)).not.toContain('ghs_token_value');
    expect(calls[0]?.url).not.toContain('ghs_token_value');
  });

  it('completes a run with the evidence report and a matching conclusion', async () => {
    const { checks, calls } = client(created);
    await checks.complete(target, 42, bundle({ verified: false, checks: [failing] }));
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/app/check-runs/42');
    expect(calls[0]?.body.conclusion).toBe('failure');
    const output = readOutput(calls[0]);
    expect(output.title).toContain('Feedback accepted');
    expect(output.title).toContain('failed');
    expect(output.text).toContain('assertion failed');
  });

  it('keeps the report inside the GitHub output limit', async () => {
    const { checks, calls } = client(created);
    await checks.publish(
      target,
      bundle({ verified: false, checks: [{ ...failing, stderr: 'x'.repeat(200_000) }] }),
    );
    expect(readOutput(calls[0]).text.length).toBeLessThanOrEqual(60_000);
  });

  it('redacts the token from a failed request instead of leaking it', async () => {
    const { checks } = client(() => new Response(`bad credentials for ${token}`, { status: 401 }));
    await expect(checks.publish(target, bundle())).rejects.toThrow(REDACTED_MARKER);
    await expect(checks.publish(target, bundle())).rejects.not.toThrow(LEAKED_TOKEN);
  });

  it('fails loudly when GitHub does not return a check run id', async () => {
    const { checks } = client(
      () =>
        new Response(JSON.stringify({ message: 'ok' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(checks.start(target)).rejects.toThrow('did not return a check run id');
  });
});
