import {
  isRepositoryRelativePath,
  redactSecrets,
  secretValuesFromEnvironment,
} from '@code-zero/shared';

/** The repository a branch or pull request is created in. */
export interface RepositoryTarget {
  owner: string;
  repo: string;
}

/**
 * One file of the published change set. `contentBase64` carries the complete new file bytes as
 * base64; `null` records a deletion. Base64 is deliberate: the tree API's inline `content` field
 * is UTF-8 text, so publishing through it would corrupt any bytes that are not valid UTF-8.
 */
export interface BranchFile {
  path: string;
  contentBase64: string | null;
}

export interface PublishBranchOptions {
  /** Branch to create. It must not exist; an existing ref is never force-updated. */
  branch: string;
  /** Commit the new branch starts from, normally the head of the default branch. */
  baseSha: string;
  message: string;
  files: BranchFile[];
}

export interface OpenPullRequestOptions {
  title: string;
  body: string;
  /** Head branch carrying the changes. Refused when it names the base branch. */
  head: string;
  base: string;
}

/**
 * An open pull request, reduced to what deciding whether to review it needs.
 *
 * Deliberately not the provider's payload: a caller reasons about the head commit and the
 * identifiers, and passing GitHub's object through would put an SDK shape into the runtime's
 * vocabulary.
 */
export interface OpenPullRequest {
  number: number;
  title: string;
  /** The commit under review. A new one is what makes a pull request worth looking at again. */
  headSha: string;
  headRef: string;
  /** The commit the change is measured against; a review reads the diff between the two. */
  baseSha: string;
  url: string;
  draft: boolean;
}

export interface GitHubPullRequestsOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

/** GitHub caps pull-request titles and bodies; staying under keeps a creation from being rejected. */
const MAX_TITLE = 256;
const MAX_BODY = 60_000;
const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
// Standard base64 with optional padding; anything else is a caller bug, refused before any request.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Git ref names this adapter is willing to create.
 *
 * Deliberately stricter than git itself: alphanumeric segments joined by `.`, `_`, `-`, and `/`.
 * Everything a ref cannot carry — and several things it technically could — is refused, because a
 * branch name assembled from external input must never smuggle unexpected ref syntax.
 */
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function isSafeBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !name.includes('..') &&
    !name.endsWith('.lock') &&
    SAFE_BRANCH.test(name)
  );
}

export function assertSafeBranchName(name: string): void {
  if (!isSafeBranchName(name)) throw new Error(`Refusing to use unsafe branch name: ${name}`);
}

/**
 * Publishes a verified change set as an isolated branch and opens a review-ready pull request.
 *
 * The default branch is never committed to: changes only ever land on a newly created ref, and an
 * existing ref is never force-updated, so a concurrent run cannot overwrite another's branch. The
 * token is only ever sent as an Authorization header, and any error body is redacted before it is
 * raised, so a failed request cannot leak a credential into logs.
 */
export class GitHubPullRequests {
  private readonly baseUrl: string;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: GitHubPullRequestsOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
    this.request = options.fetch ?? globalThis.fetch;
  }

  /** The repository's default branch and the commit it currently points at. */
  async defaultBranch(target: RepositoryTarget): Promise<{ name: string; sha: string }> {
    const repository = await this.send('GET', `/repos/${target.owner}/${target.repo}`);
    const name = readString(repository, 'default_branch');
    if (!name) throw new Error('GitHub did not report a default branch');
    const ref = await this.send(
      'GET',
      `/repos/${target.owner}/${target.repo}/git/ref/${encodeURIComponent(`heads/${name}`)}`,
    );
    const sha = readString(readRecord(ref, 'object'), 'sha');
    if (!sha || !COMMIT_SHA.test(sha))
      throw new Error(`GitHub did not report a commit for branch ${name}`);
    return { name, sha };
  }

  /**
   * Create a new branch containing exactly the supplied change set on top of `baseSha`.
   *
   * The ref creation fails when the branch already exists, which is deliberate: re-running a task
   * must produce a new branch, not silently rewrite one that may already be under review.
   */
  async publishBranch(
    target: RepositoryTarget,
    options: PublishBranchOptions,
  ): Promise<{ commitSha: string }> {
    assertSafeBranchName(options.branch);
    if (!COMMIT_SHA.test(options.baseSha))
      throw new Error('publishBranch requires a valid base commit SHA');
    if (options.files.length === 0)
      throw new Error('Refusing to publish a branch with no changed files');
    for (const file of options.files) {
      if (!isRepositoryRelativePath(file.path))
        throw new Error(`Changed path is not inside the repository: ${file.path}`);
      if (file.contentBase64 !== null && !BASE64.test(file.contentBase64))
        throw new Error(`Changed file content is not base64: ${file.path}`);
    }

    const prefix = `/repos/${target.owner}/${target.repo}`;
    const baseCommit = await this.send('GET', `${prefix}/git/commits/${options.baseSha}`);
    const baseTree = readString(readRecord(baseCommit, 'tree'), 'sha');
    if (!baseTree) throw new Error('GitHub did not report a tree for the base commit');

    // Contents go through the blob API as base64, never the tree API's inline `content` field:
    // that field is UTF-8 text, and routing bytes through it would corrupt binary files.
    const entries: Record<string, unknown>[] = [];
    for (const file of options.files) {
      if (file.contentBase64 === null) {
        entries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
        continue;
      }
      const blob = await this.send('POST', `${prefix}/git/blobs`, {
        content: file.contentBase64,
        encoding: 'base64',
      });
      const blobSha = readString(blob, 'sha');
      if (!blobSha) throw new Error(`GitHub did not return a blob id for ${file.path}`);
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blobSha });
    }

    const tree = await this.send('POST', `${prefix}/git/trees`, {
      base_tree: baseTree,
      tree: entries,
    });
    const treeSha = readString(tree, 'sha');
    if (!treeSha) throw new Error('GitHub did not return a tree id');

    const commit = await this.send('POST', `${prefix}/git/commits`, {
      message: options.message,
      tree: treeSha,
      parents: [options.baseSha],
    });
    const commitSha = readString(commit, 'sha');
    if (!commitSha) throw new Error('GitHub did not return a commit id');

    await this.send('POST', `${prefix}/git/refs`, {
      ref: `refs/heads/${options.branch}`,
      sha: commitSha,
    });
    return { commitSha };
  }

  /** Open the pull request that puts the published branch in front of human reviewers. */
  async openPullRequest(
    target: RepositoryTarget,
    options: OpenPullRequestOptions,
  ): Promise<{ number: number; url: string }> {
    assertSafeBranchName(options.head);
    if (options.head === options.base)
      throw new Error('Refusing to open a pull request whose head is its base branch');
    const body = await this.send('POST', `/repos/${target.owner}/${target.repo}/pulls`, {
      title: options.title.slice(0, MAX_TITLE),
      body: options.body.slice(0, MAX_BODY),
      head: options.head,
      base: options.base,
      maintainer_can_modify: true,
    });
    const number = readNumber(body, 'number');
    const url = readString(body, 'html_url');
    if (number === undefined || !url) throw new Error('GitHub did not return the pull request');
    return { number, url };
  }

  /**
   * The repository's open pull requests, newest first, one page at a time.
   *
   * Read-only, and the only thing here that goes looking for work rather than publishing it. A
   * page limit rather than full pagination: a caller polls repeatedly, so a repository with more
   * open pull requests than one page is one whose oldest simply wait for the next pass — which is
   * better than a poll that walks hundreds of pages every interval.
   *
   * A record GitHub returns without an integer number or a commit-shaped head sha is skipped
   * rather than raised: one malformed entry must not cost the caller the whole page.
   */
  async listOpenPullRequests(target: RepositoryTarget, perPage = 50): Promise<OpenPullRequest[]> {
    const query = new URLSearchParams({
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: String(Math.min(Math.max(Math.trunc(perPage), 1), 100)),
    });
    const payload = await this.send(
      'GET',
      `/repos/${target.owner}/${target.repo}/pulls?${query.toString()}`,
    );
    if (!Array.isArray(payload)) throw new Error('GitHub did not report a list of pull requests');
    const requests: OpenPullRequest[] = [];
    for (const entry of payload) {
      const number = readNumber(entry, 'number');
      const head = readRecord(entry, 'head');
      const headSha = readString(head, 'sha');
      const headRef = readString(head, 'ref');
      const baseSha = readString(readRecord(entry, 'base'), 'sha');
      // Both commits are required: a review reads the diff between them, so a record missing
      // either describes nothing a run could inspect.
      if (
        number === undefined ||
        !headSha ||
        !COMMIT_SHA.test(headSha) ||
        !headRef ||
        !baseSha ||
        !COMMIT_SHA.test(baseSha)
      )
        continue;
      requests.push({
        number,
        title: readString(entry, 'title') ?? '',
        headSha,
        headRef,
        baseSha,
        url: readString(entry, 'html_url') ?? '',
        draft: readRecord(entry, 'draft') === true,
      });
    }
    return requests;
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.options.token}`,
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const detail = redactSecrets(await response.text(), [
        this.options.token,
        ...secretValuesFromEnvironment(),
      ]);
      throw new Error(
        `GitHub pull request request failed (${String(response.status)}): ${detail.slice(0, 1_000)}`,
      );
    }
    return response.json();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  const entry = readRecord(value, key);
  return typeof entry === 'string' && entry.length > 0 ? entry : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  const entry = readRecord(value, key);
  return typeof entry === 'number' && Number.isInteger(entry) ? entry : undefined;
}
