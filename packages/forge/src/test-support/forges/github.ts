import { apiResponse, BASE, HEAD, SECRET, TOKEN, type ForgeFixture } from '../forge-fixture.js';

const repository = { id: 1, name: 'app', full_name: 'acme/app', owner: { login: 'acme', id: 2 } };
const alice = { login: 'alice', id: 3, type: 'User' };
const bob = { login: 'bob', id: 4, type: 'User' };
// The payload's commits are deliberately not the ones the API reports: a run trusts the forge's
// record of the change request, not the delivery that announced it.
const pullRequest = {
  number: 7,
  title: 'Fix the loader',
  state: 'open',
  draft: false,
  user: alice,
  head: { sha: 'c'.repeat(40), ref: 'feat' },
  base: { sha: 'd'.repeat(40), ref: 'main' },
};
const reviewer = { login: 'reviewer[bot]', id: 5, type: 'Bot' };

export const githubFixture: ForgeFixture = {
  kind: 'github',
  instance: 'github.com',
  owner: 'acme',
  connection: {
    kind: 'github',
    instance: 'github.com',
    auth: { type: 'token', token: TOKEN },
    webhookSecret: SECRET,
  },
  signingSecret: SECRET,
  signsBody: true,
  eventHeaders: (event) => ({ 'x-github-event': event, 'x-github-delivery': 'delivery-1' }),
  proactive: {
    event: 'pull_request',
    payload: { action: 'opened', pull_request: pullRequest, repository, sender: alice },
  },
  feedback: {
    event: 'pull_request_review',
    payload: {
      action: 'submitted',
      review: { id: 51, state: 'changes_requested', body: 'Guard the null return.', user: bob },
      pull_request: pullRequest,
      repository,
      sender: bob,
    },
  },
  feedbackAuthor: 'bob',
  feedbackText: true,
  feedbackRequestsChanges: true,
  botFeedback: {
    event: 'pull_request_review_comment',
    payload: {
      action: 'created',
      comment: {
        id: 61,
        body: 'This dereferences null.',
        path: 'src/user.ts',
        line: 3,
        user: reviewer,
      },
      pull_request: pullRequest,
      repository,
      sender: reviewer,
    },
  },
  claimFree: {
    event: 'pull_request_review',
    payload: {
      action: 'submitted',
      review: { id: 52, state: 'approved', body: 'LGTM', user: bob },
      pull_request: pullRequest,
      repository,
      sender: bob,
    },
  },
  issue: {
    event: 'issues',
    payload: {
      action: 'labeled',
      label: { name: 'code-zero' },
      issue: { number: 9, title: 'Crash', state: 'open', user: { login: 'carol', id: 6 } },
      repository,
      sender: { login: 'carol', id: 6 },
    },
  },
  api: [
    apiResponse('https://api.github.com/repos/acme/app/pulls/7', {
      ...pullRequest,
      head: { sha: HEAD, ref: 'feat' },
      base: { sha: BASE, ref: 'main' },
    }),
    apiResponse('https://api.github.com/repos/acme/app/issues/9', {
      number: 9,
      title: 'The loader crashes',
      body: 'load() returns null and callers dereference it.',
      state: 'open',
      user: { login: 'carol', id: 6, type: 'User' },
      labels: [{ name: 'Code-Zero' }, { name: 'bug' }],
    }),
  ],
};
