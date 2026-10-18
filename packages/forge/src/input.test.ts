import { describe, expect, it } from 'vitest';

import type { ChangeRequestRef, IssueEvent, ReviewEvent } from './contracts.js';
import { issueInputFromEvent, reviewInputFromEvent, sourceLabel } from './input.js';

const changeRequest: ChangeRequestRef = {
  forge: 'gitlab',
  instance: 'gitlab.com',
  owner: 'acme/platform',
  repo: 'app',
  number: 7,
  headSha: 'a'.repeat(40),
  baseSha: 'b'.repeat(40),
};

const feedback: ReviewEvent = {
  forge: 'gitlab',
  trigger: 'feedback',
  changeRequest,
  requestedChanges: false,
  items: [
    {
      id: 'comment:1',
      kind: 'review-comment',
      body: 'Null deref',
      author: 'bob',
      requestedChanges: false,
      path: 'src/user.ts',
      line: 3,
    },
    {
      id: 'comment:2',
      kind: 'review-comment',
      body: 'Escapes',
      author: 'eve',
      requestedChanges: false,
      path: '../outside.ts',
    },
  ],
};

describe('reviewInputFromEvent', () => {
  it('defaults to observe so a webhook cannot escalate a run', () => {
    const input = reviewInputFromEvent(feedback, { checkoutPath: '/checkout' });
    expect(input).toMatchObject({
      repository: '/checkout',
      mode: 'observe',
      trigger: 'feedback',
      source: 'gitlab:acme/platform/app!7',
      pullRequest: { owner: 'acme/platform', repo: 'app', number: 7 },
    });
    expect(input.feedback).toContain('[review-comment by bob on src/user.ts:3]');
  });

  it('keeps only repository-relative paths as files', () => {
    const input = reviewInputFromEvent(feedback, { checkoutPath: '/checkout' });
    expect(input.files).toEqual(['src/user.ts']);
  });

  it('never presents a partial diff range as complete', () => {
    const { baseSha: _baseSha, ...withoutBase } = changeRequest;
    const input = reviewInputFromEvent(
      { ...feedback, trigger: 'proactive', items: [], changeRequest: withoutBase },
      { checkoutPath: '/checkout', mode: 'suggest' },
    );
    expect(input.pullRequest).toBeUndefined();
    expect(input.feedback).toBeUndefined();
    expect(input.mode).toBe('suggest');
  });

  it('labels every forge but GitLab with #', () => {
    expect(sourceLabel({ ...changeRequest, forge: 'bitbucket', owner: 'acme' })).toBe(
      'bitbucket:acme/app#7',
    );
  });
});

describe('issueInputFromEvent', () => {
  const issue: IssueEvent = {
    forge: 'azure-devops',
    trigger: 'issue',
    instance: 'dev.azure.com',
    issue: { owner: 'acme/Widgets', repo: '', number: 9 },
    title: 'The loader crashes',
    body: 'load() returns null.',
    author: 'carol@acme.example',
    labels: ['code-zero'],
  };

  it('carries issue text as untrusted feedback in observe mode', () => {
    expect(issueInputFromEvent(issue, { checkoutPath: '/checkout' })).toEqual({
      repository: '/checkout',
      mode: 'observe',
      trigger: 'issue',
      source: 'azure-devops:acme/Widgets#9',
      feedback: '[issue #9 by carol@acme.example] The loader crashes\n\nload() returns null.',
      issue: { owner: 'acme/Widgets', repo: '', number: 9 },
    });
  });

  it('keeps a body-less issue as a single-line request', () => {
    const input = issueInputFromEvent({ ...issue, body: '' }, { checkoutPath: '/checkout' });
    expect(input.feedback).toBe('[issue #9 by carol@acme.example] The loader crashes');
  });
});
