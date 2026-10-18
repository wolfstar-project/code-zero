import { apiResponse, BASE, HEAD, SECRET, TOKEN, type ForgeFixture } from '../forge-fixture.js';

const api = 'https://dev.azure.com/acme/Widgets/_apis';
const repository = { id: 'r1', name: 'app', project: { id: 'p1', name: 'Widgets' } };
const alice = { uniqueName: 'alice@acme.example', displayName: 'Alice', id: 'u1' };
const bob = { uniqueName: 'bob@acme.example', displayName: 'Bob', id: 'u2' };
const buildService = {
  uniqueName: 'Build Service',
  displayName: 'Project Collection Build Service',
  id: 'u9',
  descriptor: 'svc.build',
};
const pullRequest = {
  pullRequestId: 7,
  title: 'Fix the loader',
  status: 'active',
  isDraft: false,
  repository,
  createdBy: alice,
  lastMergeSourceCommit: { commitId: HEAD },
  lastMergeTargetCommit: { commitId: BASE },
  sourceRefName: 'refs/heads/feat',
  targetRefName: 'refs/heads/main',
};
// Service hooks authenticate with Basic credentials rather than a signature.
const hookCredentials = `hook:${SECRET}`;

function commentEvent(author: Record<string, unknown>, text: string): Record<string, unknown> {
  return {
    id: 'delivery-1',
    eventType: 'ms.vss-code.git-pullrequest-comment-event',
    resource: { comment: { id: 2, content: text, author }, pullRequest },
  };
}

export const azureDevOpsFixture: ForgeFixture = {
  kind: 'azure-devops',
  instance: 'dev.azure.com',
  owner: 'acme/Widgets',
  connection: {
    kind: 'azure-devops',
    instance: 'dev.azure.com',
    organization: 'acme',
    auth: { type: 'token', token: TOKEN },
    webhookSecret: hookCredentials,
  },
  signingSecret: hookCredentials,
  signsBody: false,
  eventHeaders: () => ({}),
  proactive: {
    event: 'git.pullrequest.created',
    payload: { id: 'delivery-1', eventType: 'git.pullrequest.created', resource: pullRequest },
  },
  feedback: { event: 'comment', payload: commentEvent(bob, 'Guard the null.') },
  feedbackAuthor: 'bob@acme.example',
  // forges 0.1 normalizes an Azure DevOps pull request comment without its text.
  feedbackText: false,
  feedbackRequestsChanges: false,
  botFeedback: { event: 'comment', payload: commentEvent(buildService, 'Build failed.') },
  claimFree: {
    event: 'git.pullrequest.updated',
    payload: { id: 'delivery-1', eventType: 'git.pullrequest.updated', resource: pullRequest },
  },
  issue: {
    event: 'workitem.created',
    payload: {
      id: 'delivery-1',
      eventType: 'workitem.created',
      resource: { id: 9, fields: { 'System.Title': 'Crash', 'System.TeamProject': 'Widgets' } },
    },
  },
  api: [
    // A delivery's ref addresses the repository by its id, the poller's by its name.
    ...['r1', 'app'].map((repo) =>
      apiResponse(`${api}/git/repositories/${repo}/pullRequests/7?api-version=7.1`, {
        ...pullRequest,
        description: 'Fixes the loader.',
      }),
    ),
    apiResponse(`${api}/wit/workitems/9?%24expand=links&api-version=7.1`, {
      id: 9,
      fields: {
        'System.Title': 'The loader crashes',
        'System.Description': 'load() returns null and callers dereference it.',
        'System.State': 'New',
        'System.TeamProject': 'Widgets',
        'System.WorkItemType': 'Issue',
        'System.Tags': 'code-zero; bug',
        'System.CreatedBy': { uniqueName: 'carol@acme.example', id: 'u3', displayName: 'Carol' },
      },
    }),
    apiResponse(`${api}/wit/workitemtypes/Issue/states?api-version=7.1`, {
      value: [
        { name: 'New', category: 'Proposed' },
        { name: 'Done', category: 'Completed' },
      ],
    }),
  ],
};
