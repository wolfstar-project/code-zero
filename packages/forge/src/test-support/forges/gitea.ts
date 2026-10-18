import { apiResponse, BASE, HEAD, SECRET, TOKEN, type ForgeFixture } from '../forge-fixture.js';

/**
 * Gitea and Forgejo share one payload format; only the host, the provider, and the header names
 * that carry the event and the signature differ.
 */
function giteaFamilyFixture(
  kind: 'gitea' | 'forgejo',
  instance: string,
  headerPrefix: 'x-gitea' | 'x-forgejo',
): ForgeFixture {
  const repository = { id: 4, name: 'app', full_name: 'acme/app', owner: { login: 'acme', id: 1 } };
  const pullRequest = { id: 70, number: 7, title: 'Fix the loader', state: 'open' };
  const review = (
    sender: Record<string, unknown>,
    type: string,
    content: string,
  ): Record<string, unknown> => ({
    action: 'reviewed',
    number: 7,
    pull_request: pullRequest,
    repository,
    sender,
    review: { type, content },
  });
  const api = `https://${instance}/api/v1/repos/acme/app`;

  return {
    kind,
    instance,
    owner: 'acme',
    connection: {
      kind,
      instance,
      baseUrl: `https://${instance}`,
      auth: { type: 'token', token: TOKEN },
      webhookSecret: SECRET,
    },
    signingSecret: SECRET,
    signsBody: true,
    eventHeaders: (event) => ({
      [`${headerPrefix}-event`]: event,
      [`${headerPrefix}-delivery`]: 'delivery-1',
    }),
    proactive: {
      event: 'pull_request',
      payload: {
        action: 'opened',
        number: 7,
        pull_request: pullRequest,
        repository,
        sender: { login: 'alice', id: 2 },
      },
    },
    feedback: {
      event: 'pull_request_review_rejected',
      payload: review({ login: 'bob', id: 3 }, 'pull_request_review_rejected', 'Guard the null.'),
    },
    feedbackAuthor: 'bob',
    feedbackText: true,
    feedbackRequestsChanges: true,
    botFeedback: {
      event: 'pull_request_review_rejected',
      payload: review(
        { login: 'renovate', id: 5, is_bot: true },
        'pull_request_review_rejected',
        'Bump the dependency.',
      ),
    },
    claimFree: {
      event: 'pull_request_review_approved',
      payload: review({ login: 'bob', id: 3 }, 'pull_request_review_approved', 'LGTM'),
    },
    issue: {
      event: 'issues',
      payload: {
        action: 'opened',
        number: 9,
        issue: { number: 9, title: 'Crash', state: 'open', user: { login: 'carol', id: 6 } },
        repository,
        sender: { login: 'carol', id: 6 },
      },
    },
    api: [
      apiResponse(`${api}/pulls/7`, {
        ...pullRequest,
        draft: false,
        user: { login: 'alice', id: 2 },
        head: { sha: HEAD, ref: 'feat' },
        base: { sha: BASE, ref: 'main' },
        labels: [],
      }),
      apiResponse(`${api}/issues/9`, {
        number: 9,
        title: 'The loader crashes',
        body: 'load() returns null and callers dereference it.',
        state: 'open',
        user: { login: 'carol', id: 6 },
        labels: [{ name: 'code-zero' }],
      }),
    ],
  };
}

export const giteaFixture = giteaFamilyFixture('gitea', 'gitea.example.com', 'x-gitea');
export const forgejoFixture = giteaFamilyFixture('forgejo', 'codeberg.org', 'x-forgejo');
