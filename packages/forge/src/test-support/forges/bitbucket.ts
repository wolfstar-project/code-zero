import { apiResponse, SECRET, TOKEN, type ForgeFixture } from '../forge-fixture.js';

const repository = {
  full_name: 'acme/app',
  name: 'app',
  uuid: '{repo}',
  workspace: { slug: 'acme' },
};
const alice = { nickname: 'alice', uuid: '{alice}', display_name: 'Alice', type: 'user' };
const bob = { nickname: 'bob', uuid: '{bob}', display_name: 'Bob', type: 'user' };
const pipelines = { nickname: 'pipelines', uuid: '{app}', type: 'app_user' };
// Bitbucket reports 12-character commit hashes.
const pullRequest = {
  id: 7,
  title: 'Fix the loader',
  state: 'OPEN',
  author: alice,
  source: { commit: { hash: 'a'.repeat(12) }, branch: { name: 'feat' } },
  destination: { commit: { hash: 'b'.repeat(12) }, branch: { name: 'main' } },
};

function comment(user: Record<string, unknown>, text: string): Record<string, unknown> {
  return {
    pullrequest: pullRequest,
    repository,
    actor: user,
    comment: { id: 31, content: { raw: text }, user, inline: { path: 'src/user.ts', to: 12 } },
  };
}

export const bitbucketFixture: ForgeFixture = {
  kind: 'bitbucket',
  instance: 'bitbucket.org',
  owner: 'acme',
  connection: {
    kind: 'bitbucket',
    instance: 'bitbucket.org',
    auth: { type: 'basic', username: 'ops@acme.example', password: TOKEN },
    webhookSecret: SECRET,
  },
  signingSecret: SECRET,
  signsBody: true,
  eventHeaders: (event) => ({ 'x-event-key': event, 'x-request-uuid': 'delivery-1' }),
  proactive: {
    event: 'pullrequest:created',
    payload: { pullrequest: pullRequest, repository, actor: alice },
  },
  feedback: { event: 'pullrequest:comment_created', payload: comment(bob, 'Guard the null.') },
  feedbackAuthor: 'bob',
  // forges 0.1 normalizes a Bitbucket comment without its text or inline anchor.
  feedbackText: false,
  feedbackRequestsChanges: false,
  botFeedback: {
    event: 'pullrequest:comment_created',
    payload: comment(pipelines, 'Build failed.'),
  },
  claimFree: {
    event: 'pullrequest:approved',
    payload: { pullrequest: pullRequest, repository, actor: bob, approval: { user: bob } },
  },
  api: [
    apiResponse('https://api.bitbucket.org/2.0/repositories/acme/app/pullrequests/7', {
      ...pullRequest,
      description: 'Fixes the loader.',
      draft: false,
    }),
  ],
};
