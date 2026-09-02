import type { EvidenceBundle } from '@code-zero/shared';
import { describe, expect, it } from 'vitest';

import {
  issueBranchName,
  issueInputFromTask,
  parseIssueTask,
  prepareIssuePullRequest,
  prepareIssueValidationComment,
  VALIDATION_COMMENT_MARKER,
} from './github-issues.js';

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'labeled',
    issue: {
      number: 12,
      state: 'open',
      title: 'Guard the null return in the loader',
      body: 'load() returns null and callers dereference it.',
      user: { login: 'dev', type: 'User' },
      labels: [{ name: 'code-zero' }, { name: 'bug' }],
      ...(isRecord(overrides.issue) ? overrides.issue : {}),
    },
    repository: { name: 'app', owner: { login: 'acme' } },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'issue')),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const requireLabel = { requireLabel: 'code-zero' };

describe('parseIssueTask', () => {
  it('produces a task for an open, labeled issue', () => {
    const task = parseIssueTask('issues', payload(), requireLabel);
    expect(task).toEqual({
      issue: { owner: 'acme', repo: 'app', number: 12 },
      title: 'Guard the null return in the loader',
      body: 'load() returns null and callers dereference it.',
      author: 'dev',
      labels: ['code-zero', 'bug'],
    });
  });

  it('ignores an issue that does not carry the required label', () => {
    expect(
      parseIssueTask('issues', payload({ issue: { labels: [{ name: 'bug' }] } }), requireLabel),
    ).toBeNull();
  });

  it('matches the required label case-insensitively', () => {
    expect(
      parseIssueTask(
        'issues',
        payload({ issue: { labels: [{ name: 'Code-Zero' }] } }),
        requireLabel,
      ),
    ).not.toBeNull();
  });

  it('ignores events that carry no new work', () => {
    for (const action of ['closed', 'unlabeled', 'edited', 'assigned'])
      expect(parseIssueTask('issues', payload({ action }), requireLabel)).toBeNull();
    expect(parseIssueTask('issue_comment', payload(), requireLabel)).toBeNull();
  });

  it('refuses a closed issue and a pull request masquerading as an issue', () => {
    expect(
      parseIssueTask('issues', payload({ issue: { state: 'closed' } }), requireLabel),
    ).toBeNull();
    expect(
      parseIssueTask(
        'issues',
        payload({ issue: { pull_request: { url: 'https://example.invalid' } } }),
        requireLabel,
      ),
    ).toBeNull();
  });

  it('ignores its own account so a run cannot loop on issues it files', () => {
    expect(
      parseIssueTask('issues', payload(), { ...requireLabel, ignoreAuthors: ['DEV'] }),
    ).toBeNull();
  });

  it('can refuse bot-authored issues', () => {
    const fromBot = payload({ issue: { user: { login: 'robo[bot]', type: 'Bot' } } });
    expect(parseIssueTask('issues', fromBot, { ...requireLabel, allowBots: false })).toBeNull();
    expect(parseIssueTask('issues', fromBot, requireLabel)).not.toBeNull();
  });

  it('bounds untrusted titles and bodies', () => {
    const task = parseIssueTask(
      'issues',
      payload({ issue: { title: `x${'y'.repeat(1_000)}`, body: 'z'.repeat(100_000) } }),
      requireLabel,
    );
    expect(task?.title.length).toBe(300);
    expect(task?.body.length).toBe(20_000);
  });

  it('returns null for malformed payloads instead of throwing', () => {
    expect(parseIssueTask('issues', null, requireLabel)).toBeNull();
    expect(parseIssueTask('issues', { action: 'opened' }, requireLabel)).toBeNull();
    expect(
      parseIssueTask('issues', payload({ issue: { number: 'twelve' } }), requireLabel),
    ).toBeNull();
    expect(parseIssueTask('issues', payload({ issue: { title: '   ' } }), requireLabel)).toBeNull();
  });
});

describe('issueInputFromTask', () => {
  const task = parseIssueTask('issues', payload(), requireLabel)!;

  it('defaults to observe so a webhook cannot escalate authority on its own', () => {
    const input = issueInputFromTask(task, { checkoutPath: '/checkout' });
    expect(input.mode).toBe('observe');
    expect(input.trigger).toBe('issue');
    expect(input.source).toBe('github:acme/app#12');
    expect(input.issue).toEqual({ owner: 'acme', repo: 'app', number: 12 });
    expect(input.feedback).toContain('[issue #12 by dev] Guard the null return in the loader');
    expect(input.feedback).toContain('load() returns null');
  });

  it('keeps a body-less issue as a single-line request', () => {
    const bare = parseIssueTask('issues', payload({ issue: { body: undefined } }), requireLabel)!;
    const input = issueInputFromTask(bare, { checkoutPath: '/checkout', mode: 'fix' });
    expect(input.mode).toBe('fix');
    expect(input.feedback).toBe('[issue #12 by dev] Guard the null return in the loader');
  });
});

describe('issueBranchName', () => {
  const issue = { owner: 'acme', repo: 'app', number: 12 };

  it('derives a deterministic branch from policy, issue number, and task id', () => {
    expect(issueBranchName('code-zero/', issue, 'cz_ABC-123')).toBe(
      'code-zero/issue-12-cz-abc-123',
    );
  });

  it('refuses a prefix that would produce an invalid ref', () => {
    expect(() => issueBranchName('bad prefix ', issue, 'cz_1')).toThrow('unsafe branch name');
    expect(() => issueBranchName('../heads/', issue, 'cz_1')).toThrow('unsafe branch name');
  });
});

const bundle: EvidenceBundle = {
  taskId: 'cz_test',
  state: 'completed',
  verdict: 'accepted',
  verified: true,
  mode: 'fix',
  trigger: 'issue',
  source: 'github:acme/app#12',
  issue: { owner: 'acme', repo: 'app', number: 12 },
  runner: { kind: 'container', isolated: true, writable: true, network: 'none' },
  finding: {
    id: 'cz_test_finding',
    changeRisk: 'behavioral',
    title: 'Guard the null return in the loader',
    explanation: 'load() returns null but callers dereference it.',
    severity: 'high',
    confidence: 0.92,
    valid: true,
    evidence: ['`return null;` in src/user.ts'],
    files: ['src/user.ts'],
    verdict: 'accepted',
    rejectionReasons: [],
  },
  plan: ['Guard the null return'],
  acceptanceCriteria: ['load() never returns null'],
  changedFiles: ['src/user.ts'],
  checks: [{ command: 'pnpm run test', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 10 }],
  attempts: 1,
  transitions: [],
  summary: 'Fixed and verified: Guard the null return in the loader',
};

describe('prepareIssuePullRequest', () => {
  it('composes a review-ready pull request from a verified issue run', () => {
    const readiness = prepareIssuePullRequest(bundle);
    expect(readiness).toMatchObject({ ready: true });
    if (!readiness.ready) return;
    expect(readiness.title).toBe('Guard the null return in the loader');
    expect(readiness.body).toContain('Closes #12.');
    expect(readiness.body).toContain('### Acceptance criteria');
    expect(readiness.body).toContain('load() never returns null');
    expect(readiness.body).toContain('passed (1 checks)');
  });

  it('refuses a run that is not verified, whatever its state claims', () => {
    const unverified = prepareIssuePullRequest({ ...bundle, verified: false });
    expect(unverified).toMatchObject({ ready: false });
    if (unverified.ready) return;
    expect(unverified.reason).toContain('not verified');
  });

  it('refuses every non-completed terminal state', () => {
    expect(prepareIssuePullRequest({ ...bundle, state: 'needs-human' })).toMatchObject({
      ready: false,
      reason: 'The run is waiting for human approval.',
    });
    expect(prepareIssuePullRequest({ ...bundle, state: 'failed' })).toMatchObject({ ready: false });
  });

  it('refuses a run that changed nothing or was not accepted', () => {
    expect(prepareIssuePullRequest({ ...bundle, changedFiles: [] })).toMatchObject({
      ready: false,
    });
    expect(prepareIssuePullRequest({ ...bundle, verdict: 'inconclusive' })).toMatchObject({
      ready: false,
    });
  });

  it('re-checks the high-impact approval gate at publication', () => {
    const highImpact = prepareIssuePullRequest({
      ...bundle,
      finding: { ...bundle.finding!, changeRisk: 'high-impact' },
    });
    expect(highImpact).toMatchObject({ ready: false });
    if (highImpact.ready) return;
    expect(highImpact.reason).toContain('human approval');
  });

  it('only publishes issue-triggered runs that name their issue', () => {
    expect(prepareIssuePullRequest({ ...bundle, trigger: 'feedback' })).toMatchObject({
      ready: false,
    });
    expect(prepareIssuePullRequest({ ...bundle, issue: null })).toMatchObject({ ready: false });
  });

  it('redacts credentials that leaked into the summary', () => {
    const leaking = prepareIssuePullRequest({
      ...bundle,
      summary: 'done with ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    });
    if (!leaking.ready) throw new Error('expected a ready pull request');
    expect(leaking.body).not.toContain('ghp_0123456789');
  });
});

describe('prepareIssueValidationComment', () => {
  it('reports a confirmed issue with its evidence and criteria', () => {
    const comment = prepareIssueValidationComment(bundle);
    if (!comment.ready) throw new Error('expected a ready comment');
    expect(comment.body).toContain(VALIDATION_COMMENT_MARKER);
    expect(comment.body).toContain('**Confirmed.**');
    expect(comment.body).toContain('`return null;` in src/user.ts');
    expect(comment.body).toContain('load() never returns null');
    expect(comment.body).toContain('see the linked pull request');
  });

  it('reports a rejected issue with every rejection reason', () => {
    const comment = prepareIssueValidationComment({
      ...bundle,
      verdict: 'rejected',
      verified: false,
      changedFiles: [],
      summary: 'Rejected the feedback with evidence',
      finding: {
        ...bundle.finding!,
        verdict: 'rejected',
        valid: false,
        rejectionReasons: ['None of the cited files exist in the checkout: src/ghost.ts.'],
      },
    });
    if (!comment.ready) throw new Error('expected a ready comment');
    expect(comment.body).toContain('**Not confirmed.**');
    expect(comment.body).toContain('src/ghost.ts');
    expect(comment.body).not.toContain('pull request');
  });

  it('reports an inconclusive issue as needing a human', () => {
    const comment = prepareIssueValidationComment({
      ...bundle,
      state: 'needs-human',
      verdict: 'inconclusive',
      verified: false,
      changedFiles: [],
    });
    if (!comment.ready) throw new Error('expected a ready comment');
    expect(comment.body).toContain('**Inconclusive.**');
    expect(comment.body).toContain('a human should take a look');
  });

  it('never claims a fix without a verified change', () => {
    const comment = prepareIssueValidationComment({ ...bundle, verified: false });
    if (!comment.ready) throw new Error('expected a ready comment');
    expect(comment.body).not.toContain('see the linked pull request');
  });

  it('reports nothing for a failed run or a non-issue trigger', () => {
    expect(prepareIssueValidationComment({ ...bundle, state: 'failed' })).toMatchObject({
      ready: false,
    });
    expect(prepareIssueValidationComment({ ...bundle, trigger: 'feedback' })).toMatchObject({
      ready: false,
    });
    expect(prepareIssueValidationComment({ ...bundle, issue: null })).toMatchObject({
      ready: false,
    });
  });

  it('keeps a multi-line reason from restructuring the comment and bounds the list', () => {
    const reasons = Array.from(
      { length: 15 },
      (_unused, index) => `reason ${String(index)}\nwith a second line`,
    );
    const comment = prepareIssueValidationComment({
      ...bundle,
      verdict: 'rejected',
      finding: { ...bundle.finding!, verdict: 'rejected', rejectionReasons: reasons },
    });
    if (!comment.ready) throw new Error('expected a ready comment');
    expect(comment.body).toContain('- reason 0 with a second line');
    expect(comment.body).toContain('… and 5 more in the task evidence');
  });

  it('redacts credentials before they can reach the issue thread', () => {
    const comment = prepareIssueValidationComment({
      ...bundle,
      summary: 'done with ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    });
    if (!comment.ready) throw new Error('expected a ready comment');
    expect(comment.body).not.toContain('ghp_0123456789');
  });
});
