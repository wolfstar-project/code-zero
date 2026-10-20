import { describe, expect, it } from 'vitest';

import { prepareIssuePullRequest, prepareIssueValidationComment } from './issue-gate.js';
import { issueBundle as bundle } from './test-support/evidence.js';

const finding =
  bundle.finding ??
  (() => {
    throw new Error('the fixture has a finding');
  })();

describe('prepareIssuePullRequest', () => {
  it('composes a review-ready pull request from a verified issue run', () => {
    const readiness = prepareIssuePullRequest(bundle);
    if (!readiness.ready) throw new Error(readiness.reason);
    expect(readiness.title).toBe('Guard the null return in the loader');
    expect(readiness.body).toContain('Closes #9.');
    expect(readiness.body).toContain('load() never returns null');
  });

  it('links the issue the way the forge does', () => {
    const readiness = prepareIssuePullRequest(bundle, 'acme/app#9');
    if (!readiness.ready) throw new Error(readiness.reason);
    expect(readiness.body).toContain('Closes acme/app#9.');
  });

  it('refuses every run that has not earned a pull request', () => {
    const refused = [
      { ...bundle, verified: false },
      { ...bundle, state: 'needs-human' as const },
      { ...bundle, state: 'failed' as const },
      { ...bundle, changedFiles: [] },
      { ...bundle, verdict: 'inconclusive' as const },
      { ...bundle, trigger: 'feedback' as const },
      { ...bundle, issue: null },
      { ...bundle, finding: null },
      { ...bundle, finding: { ...finding, changeRisk: 'high-impact' as const } },
    ];
    for (const run of refused) expect(prepareIssuePullRequest(run).ready).toBe(false);
  });

  it('redacts credentials that leaked into the summary', () => {
    const leaking = prepareIssuePullRequest({
      ...bundle,
      summary: 'done with ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    });
    if (!leaking.ready) throw new Error(leaking.reason);
    expect(leaking.body).not.toContain('ghp_0123456789');
  });
});

describe('prepareIssueValidationComment', () => {
  it('reports a confirmed issue with its evidence and criteria', () => {
    const comment = prepareIssueValidationComment(bundle);
    if (!comment.ready) throw new Error(comment.reason);
    expect(comment.body).toContain('**Confirmed.**');
    expect(comment.body).toContain('`return null;` in src/user.ts');
    expect(comment.body).toContain('see the linked pull request');
  });

  it('reports a rejected issue with every rejection reason, and claims no fix', () => {
    const comment = prepareIssueValidationComment({
      ...bundle,
      verdict: 'rejected',
      verified: false,
      changedFiles: [],
      finding: { ...finding, verdict: 'rejected', rejectionReasons: ['src/ghost.ts is missing.'] },
    });
    if (!comment.ready) throw new Error(comment.reason);
    expect(comment.body).toContain('**Not confirmed.**');
    expect(comment.body).toContain('src/ghost.ts');
    expect(comment.body).not.toContain('pull request');
  });

  it('reports an inconclusive issue as needing a human', () => {
    const comment = prepareIssueValidationComment({ ...bundle, verdict: 'inconclusive' });
    if (!comment.ready) throw new Error(comment.reason);
    expect(comment.body).toContain('a human should take a look');
  });

  it('reports nothing for a failed run or a non-issue trigger', () => {
    expect(prepareIssueValidationComment({ ...bundle, state: 'failed' }).ready).toBe(false);
    expect(prepareIssueValidationComment({ ...bundle, trigger: 'feedback' }).ready).toBe(false);
  });

  it('keeps a multi-line reason from restructuring the comment and bounds the list', () => {
    const reasons = Array.from({ length: 15 }, (_unused, index) => `reason ${String(index)}\nnext`);
    const comment = prepareIssueValidationComment({
      ...bundle,
      verdict: 'rejected',
      finding: { ...finding, verdict: 'rejected', rejectionReasons: reasons },
    });
    if (!comment.ready) throw new Error(comment.reason);
    expect(comment.body).toContain('- reason 0 next');
    expect(comment.body).toContain('… and 5 more in the task evidence');
  });
});
