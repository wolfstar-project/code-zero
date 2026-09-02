import {
  evidenceTitle,
  redactSecrets,
  renderEvidenceMarkdown,
  secretValuesFromEnvironment,
  type EvidenceBundle,
  type FeedbackItem,
} from '@code-zero/shared';

import {
  ProviderConfigurationError,
  runOutcome,
  type ChangeRequestRef,
  type ParseOptions,
  type ProviderCapabilities,
  type ReviewEvent,
  type SourceControlProvider,
  type StatusPublication,
  type StatusPublisherOptions,
  type WebhookDelivery,
  type WebhookHeaders,
} from '../contracts.js';
import { verifyHmacSha256 } from '../signatures.js';
import {
  acceptAuthor,
  isRecord,
  readBody,
  readHeader,
  readId,
  readLine,
  readPositiveInteger,
  readRecord,
  readSha,
  readString,
} from '../untrusted.js';

/** Webhook event names this adapter understands. */
export const supportedEvents = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
] as const;
export type SupportedEvent = (typeof supportedEvents)[number];

/** Conclusions a GitHub check run may report. */
export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'action_required';

/** GitHub caps check output fields; staying under the limit keeps a report from being rejected. */
const MAX_OUTPUT = 60_000;
const MAX_TITLE = 255;
const MAX_SUMMARY = 4_000;

const capabilities: ProviderCapabilities = {
  webhookAuthentication: 'hmac-sha256',
  statusReporting: 'check-runs',
  neutralStatus: true,
  actionRequiredStatus: true,
  reviewSubmissions: true,
  changeRequests: true,
  inlineComments: true,
  botAuthorDetection: true,
  diffBase: true,
  changeRequestNoun: 'pull request',
};

/** Terminal run outcomes map one-to-one onto GitHub check conclusions. */
export function checkConclusion(bundle: EvidenceBundle): CheckConclusion {
  const outcome = runOutcome(bundle);
  return outcome === 'action-required' ? 'action_required' : outcome;
}

export interface GitHubChecksOptions {
  token: string;
  baseUrl?: string;
  /** Check run name, so several Code Zero configurations can report side by side. */
  name?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Publishes run evidence to the GitHub Checks API.
 *
 * The token is only ever sent as an Authorization header, and any error body is redacted before
 * it is raised, so a failed publish cannot leak a credential into logs.
 */
export class GitHubChecks {
  private readonly baseUrl: string;
  private readonly name: string;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: GitHubChecksOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
    this.name = options.name ?? 'Code Zero';
    this.request = options.fetch ?? globalThis.fetch;
  }

  /** Open an in-progress check run so a long verification is visible while it happens. */
  async start(target: Pick<ChangeRequestRef, 'owner' | 'repo' | 'headSha'>): Promise<number> {
    const body = await this.send('POST', `/repos/${target.owner}/${target.repo}/check-runs`, {
      name: this.name,
      head_sha: target.headSha,
      status: 'in_progress',
    });
    return readCheckRunId(body);
  }

  /** Complete an existing check run with the run's evidence. */
  async complete(
    target: Pick<ChangeRequestRef, 'owner' | 'repo'>,
    checkRunId: number,
    bundle: EvidenceBundle,
  ): Promise<void> {
    await this.send(
      'PATCH',
      `/repos/${target.owner}/${target.repo}/check-runs/${String(checkRunId)}`,
      this.completionPayload(bundle),
    );
  }

  /** Create an already-completed check run, for a verification that finished quickly. */
  async publish(
    target: Pick<ChangeRequestRef, 'owner' | 'repo' | 'headSha'>,
    bundle: EvidenceBundle,
  ): Promise<number> {
    const body = await this.send('POST', `/repos/${target.owner}/${target.repo}/check-runs`, {
      name: this.name,
      head_sha: target.headSha,
      ...this.completionPayload(bundle),
    });
    return readCheckRunId(body);
  }

  /** The request body for a finished check run, including the rendered evidence report. */
  completionPayload(bundle: EvidenceBundle): Record<string, unknown> {
    const secrets = secretValuesFromEnvironment();
    return {
      status: 'completed',
      conclusion: checkConclusion(bundle),
      output: {
        title: redactSecrets(evidenceTitle(bundle), secrets).slice(0, MAX_TITLE),
        summary: redactSecrets(bundle.summary, secrets).slice(0, MAX_SUMMARY),
        text: renderEvidenceMarkdown(bundle, { maxLength: MAX_OUTPUT, secrets }),
      },
    };
  }

  private async send(
    method: 'POST' | 'PATCH',
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.options.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = redactSecrets(await response.text(), [
        this.options.token,
        ...secretValuesFromEnvironment(),
      ]);
      throw new Error(
        `GitHub check run request failed (${String(response.status)}): ${detail.slice(0, 1_000)}`,
      );
    }
    return response.json();
  }
}

function readCheckRunId(body: unknown): number {
  if (typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'number')
    return body.id;
  throw new Error('GitHub did not return a check run id');
}

/**
 * Turn a GitHub webhook payload into a review event, or null when there is nothing to act on.
 *
 * The payload is untrusted, so every field is checked rather than asserted. Approvals and
 * dismissals produce nothing: there is no claim to validate.
 */
export function parseReviewEvent(
  event: string,
  payload: unknown,
  options: ParseOptions = {},
): ReviewEvent | null {
  if (!isRecord(payload)) return null;
  const changeRequest = readChangeRequest(payload);
  if (!changeRequest) return null;

  if (event === 'pull_request') {
    if (!isProactiveAction(payload.action)) return null;
    return {
      provider: 'github',
      trigger: 'proactive',
      changeRequest,
      items: [],
      requestedChanges: false,
    };
  }

  const items =
    event === 'pull_request_review_comment'
      ? readReviewComment(payload, options)
      : event === 'pull_request_review'
        ? readReview(payload, options)
        : null;
  if (!items || items.length === 0) return null;

  return {
    provider: 'github',
    trigger: 'feedback',
    changeRequest,
    items,
    requestedChanges: items.some((item) => item.requestedChanges),
  };
}

function readReviewComment(
  payload: Record<string, unknown>,
  options: ParseOptions,
): FeedbackItem[] | null {
  if (payload.action !== 'created') return null;
  const comment = readRecord(payload.comment);
  if (!comment) return null;
  const author = readGitHubAuthor(comment.user, options);
  const body = readBody(comment.body);
  if (author === null || body === null) return null;
  const path = readString(comment.path);
  const line = readLine(comment.line ?? comment.original_line);
  return [
    {
      id: readId(comment.id, 'review-comment'),
      kind: 'review-comment',
      body,
      author,
      // A single inline comment is a remark; the review that carries it decides on changes.
      requestedChanges: false,
      ...(path === undefined ? {} : { path }),
      ...(line === undefined ? {} : { line }),
    },
  ];
}

function readReview(
  payload: Record<string, unknown>,
  options: ParseOptions,
): FeedbackItem[] | null {
  if (payload.action !== 'submitted') return null;
  const review = readRecord(payload.review);
  if (!review) return null;
  const state = typeof review.state === 'string' ? review.state.toLowerCase() : '';
  // An approval or a dismissal carries no claim to validate.
  if (state !== 'changes_requested' && state !== 'commented') return null;
  const author = readGitHubAuthor(review.user, options);
  const body = readBody(review.body);
  if (author === null || body === null) return null;
  return [
    {
      id: readId(review.id, 'review'),
      kind: 'review-body',
      body,
      author,
      requestedChanges: state === 'changes_requested',
    },
  ];
}

function readChangeRequest(payload: Record<string, unknown>): ChangeRequestRef | null {
  const pullRequest = readRecord(payload.pull_request);
  const repository = readRecord(payload.repository);
  if (!pullRequest || !repository) return null;

  const number = readPositiveInteger(pullRequest.number);
  const headSha = readSha(readRecord(pullRequest.head)?.sha);
  const baseSha = readSha(readRecord(pullRequest.base)?.sha);
  const repo = readString(repository.name);
  const owner = readString(readRecord(repository.owner)?.login);

  if (number === undefined || !baseSha || !headSha || !repo || !owner) return null;
  return { provider: 'github', owner, repo, number, baseSha, headSha };
}

function isProactiveAction(action: unknown): boolean {
  return (
    action === 'opened' ||
    action === 'reopened' ||
    action === 'synchronize' ||
    action === 'ready_for_review'
  );
}

function readGitHubAuthor(user: unknown, options: ParseOptions): string | null {
  const record = readRecord(user);
  if (!record) return null;
  return acceptAuthor(readString(record.login), record.type === 'Bot', options);
}

class GitHubStatusPublisher {
  constructor(private readonly checks: GitHubChecks) {}

  async publish(target: ChangeRequestRef, bundle: EvidenceBundle): Promise<StatusPublication> {
    await this.checks.publish(target, bundle);
    return { outcome: runOutcome(bundle), state: checkConclusion(bundle) };
  }
}

export const githubProvider: SourceControlProvider = {
  kind: 'github',
  capabilities,
  recognizes(headers: WebhookHeaders): boolean {
    // Gitea and Forgejo send an X-GitHub-Event compatibility header; their own header wins.
    if (readHeader(headers, 'x-gitea-event') || readHeader(headers, 'x-forgejo-event'))
      return false;
    return readHeader(headers, 'x-github-event') !== undefined;
  },
  eventName(headers: WebhookHeaders): string | undefined {
    return readHeader(headers, 'x-github-event');
  },
  verifyWebhook(delivery: WebhookDelivery, secret: string): boolean {
    const signature = readHeader(delivery.headers, 'x-hub-signature-256');
    return verifyHmacSha256(delivery.body, signature, secret, 'sha256=');
  },
  parseReviewEvent,
  statusPublisher(options: StatusPublisherOptions): GitHubStatusPublisher {
    if (options.token.length === 0)
      throw new ProviderConfigurationError('github', 'a status token is required');
    return new GitHubStatusPublisher(
      new GitHubChecks({
        token: options.token,
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        ...(options.name ? { name: options.name } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
    );
  },
};

/**
 * Verify a GitHub webhook signature in constant time.
 *
 * Kept as a named export for callers that verify before routing; equivalent to
 * `githubProvider.verifyWebhook` on a delivery whose header is already extracted.
 */
export function verifyWebhook(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  return verifyHmacSha256(body, signature, secret, 'sha256=');
}
