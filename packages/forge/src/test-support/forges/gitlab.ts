import { apiResponse, BASE, HEAD, SECRET, TOKEN, type ForgeFixture } from '../forge-fixture.js';

const project = { id: 3, path_with_namespace: 'acme/platform/app', name: 'app' };
const mergeRequest = {
  id: 70,
  iid: 7,
  title: 'Fix the loader',
  state: 'opened',
  last_commit: { id: HEAD },
};
const bob = { username: 'bob', id: 2, name: 'Bob' };

function note(user: Record<string, unknown>, text: string): Record<string, unknown> {
  return {
    object_kind: 'note',
    user,
    project,
    object_attributes: { id: 11, note: text, noteable_type: 'MergeRequest' },
    merge_request: mergeRequest,
  };
}

export const gitlabFixture: ForgeFixture = {
  kind: 'gitlab',
  instance: 'gitlab.com',
  owner: 'acme/platform',
  connection: {
    kind: 'gitlab',
    instance: 'gitlab.com',
    auth: { type: 'token', token: TOKEN },
    webhookSecret: SECRET,
  },
  signingSecret: SECRET,
  signsBody: false,
  eventHeaders: (event) => ({ 'x-gitlab-event': event, 'x-gitlab-event-uuid': 'delivery-1' }),
  proactive: {
    event: 'Merge Request Hook',
    payload: {
      object_kind: 'merge_request',
      user: { username: 'alice', id: 1 },
      project,
      object_attributes: { ...mergeRequest, action: 'open' },
    },
  },
  feedback: { event: 'Note Hook', payload: note(bob, 'This dereferences a null return.') },
  feedbackAuthor: 'bob',
  feedbackText: true,
  // GitLab notes are remarks; a formal request for changes arrives without text.
  feedbackRequestsChanges: false,
  botFeedback: {
    event: 'Note Hook',
    payload: note({ username: 'renovate-bot', id: 9, bot: true }, 'Bump the dependency.'),
  },
  claimFree: {
    event: 'Merge Request Hook',
    payload: {
      object_kind: 'merge_request',
      user: bob,
      project,
      object_attributes: { ...mergeRequest, action: 'approved' },
    },
  },
  issue: {
    event: 'Issue Hook',
    payload: {
      object_kind: 'issue',
      user: { username: 'carol', id: 6 },
      project,
      object_attributes: { id: 90, iid: 9, title: 'Crash', state: 'opened', action: 'open' },
    },
  },
  api: [
    apiResponse('https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapp/merge_requests/7', {
      iid: 7,
      id: 70,
      title: 'Fix the loader',
      state: 'opened',
      draft: false,
      author: { username: 'alice', id: 1 },
      sha: HEAD,
      diff_refs: { base_sha: BASE, head_sha: HEAD, start_sha: BASE },
      source_branch: 'feat',
      target_branch: 'main',
      labels: [],
    }),
    apiResponse('https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapp/issues/9', {
      iid: 9,
      id: 90,
      title: 'The loader crashes',
      description: 'load() returns null and callers dereference it.',
      state: 'opened',
      author: { username: 'carol', id: 6 },
      labels: ['code-zero'],
    }),
  ],
};
