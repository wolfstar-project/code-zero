import { redactSecrets, secretValuesFromEnvironment, type IssueRef } from '@code-zero/shared';

export interface GitHubIssueCommentsOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

/** GitHub caps comment bodies; staying under the limit keeps a report from being rejected. */
const MAX_BODY = 65_000;

/**
 * Posts validation reports as issue comments.
 *
 * Comments are report-only: this adapter can add a comment and nothing else, so a defect here can
 * never edit an issue, change labels, or close anything. The token is only ever sent as an
 * Authorization header, and any error body is redacted before it is raised, so a failed post
 * cannot leak a credential into logs.
 */
export class GitHubIssueComments {
  private readonly baseUrl: string;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: GitHubIssueCommentsOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
    this.request = options.fetch ?? globalThis.fetch;
  }

  /** Create one comment on the issue and return its id. */
  async create(issue: IssueRef, body: string): Promise<number> {
    const response = await this.request(
      `${this.baseUrl}/repos/${issue.owner}/${issue.repo}/issues/${String(issue.number)}/comments`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ body: body.slice(0, MAX_BODY) }),
      },
    );
    if (!response.ok) {
      const detail = redactSecrets(await response.text(), [
        this.options.token,
        ...secretValuesFromEnvironment(),
      ]);
      throw new Error(
        `GitHub issue comment request failed (${String(response.status)}): ${detail.slice(0, 1_000)}`,
      );
    }
    return readCommentId(await response.json());
  }
}

function readCommentId(body: unknown): number {
  if (typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'number')
    return body.id;
  throw new Error('GitHub did not return a comment id');
}
