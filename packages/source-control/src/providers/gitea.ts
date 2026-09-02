import {
  evidenceTitle,
  redactSecrets,
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
  type RunOutcome,
  type SourceControlProvider,
  type StatusPublication,
  type StatusPublisher,
  type StatusPublisherOptions,
  type WebhookDelivery,
  type WebhookHeaders,
} from '../contracts.js';
import { verifyHmacSha256 } from '../signatures.js';
import { sendProviderRequest } from '../status.js';
import {
  acceptAuthor,
  readBody,
  readHeader,
  readId,
  readPositiveInteger,
  readRecord,
  readSha,
  readString,
} from '../untrusted.js';

const MAX_DESCRIPTION = 1_000;
const TRAILING_SLASH = /\/$/u;

/**
 * One adapter serves Gitea and Forgejo: Forgejo keeps Gitea's payload shapes and sends both its
 * own and Gitea's compatibility headers. Review submissions arrive as whole events without
 * per-comment file anchors, so inline positions are not promised.
 */
const capabilities: ProviderCapabilities = {
  webhookAuthentication: 'hmac-sha256',
  statusReporting: 'commit-status',
  neutralStatus: false,
  actionRequiredStatus: false,
  reviewSubmissions: true,
  changeRequests: true,
  inlineComments: false,
  botAuthorDetection: false,
  diffBase: true,
  changeRequestNoun: 'pull request',
};

const REVIEW_EVENT = /^pull_request_review/u;

/** Turn a Gitea or Forgejo webhook payload into a review event, or null when nothing is actionable. */
export function parseGiteaReviewEvent(
  event: string,
  payload: unknown,
  options: ParseOptions = {},
): ReviewEvent | null {
  const record = readRecord(payload);
  if (!record) return null;
  const changeRequest = readChangeRequest(record);
  if (!changeRequest) return null;

  if (event === 'pull_request') {
    if (!isProactiveAction(record.action)) return null;
    return {
      provider: 'gitea',
      trigger: 'proactive',
      changeRequest,
      items: [],
      requestedChanges: false,
    };
  }

  if (!REVIEW_EVENT.test(event)) return null;
  const items = readReview(event, record, options);
  if (!items || items.length === 0) return null;
  return {
    provider: 'gitea',
    trigger: 'feedback',
    changeRequest,
    items,
    requestedChanges: items.some((item) => item.requestedChanges),
  };
}

function isProactiveAction(action: unknown): boolean {
  return (
    action === 'opened' ||
    action === 'reopened' ||
    action === 'synchronize' ||
    action === 'synchronized' ||
    action === 'ready_for_review'
  );
}

/**
 * Gitea names review events `pull_request_review_approved`, `..._rejected`, and `..._comment`;
 * some versions send a plain `pull_request_review` and disambiguate through `review.type`. Both
 * spellings are accepted, and an approval produces nothing: there is no claim to validate.
 */
function readReview(
  event: string,
  payload: Record<string, unknown>,
  options: ParseOptions,
): FeedbackItem[] | null {
  const review = readRecord(payload.review);
  if (!review) return null;
  const marker = `${event} ${readString(review.type) ?? ''}`;
  if (marker.includes('approved')) return null;
  const requestedChanges = marker.includes('rejected');
  if (!requestedChanges && !marker.includes('comment')) return null;

  const author = acceptAuthor(readString(readRecord(payload.sender)?.login), false, options);
  const body = readBody(review.content);
  if (author === null || body === null) return null;
  return [
    {
      id: readId(review.id, 'review'),
      kind: 'review-body',
      body,
      author,
      requestedChanges,
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
  const ownerRecord = readRecord(repository.owner);
  const owner = readString(ownerRecord?.login) ?? readString(ownerRecord?.username);
  if (number === undefined || !headSha || !baseSha || !repo || !owner) return null;
  return { provider: 'gitea', owner, repo, number, headSha, baseSha };
}

const stateByOutcome: Record<RunOutcome, string> = {
  success: 'success',
  failure: 'failure',
  // Gitea statuses have no neutral state; nothing is wrong on a neutral outcome, so it maps to
  // success. `warning` is the closest visible signal for a run that needs a human. Both are
  // reported as degraded.
  neutral: 'success',
  'action-required': 'warning',
};

class GiteaStatusPublisher implements StatusPublisher {
  constructor(
    private readonly options: StatusPublisherOptions,
    private readonly baseUrl: string,
  ) {}

  async publish(target: ChangeRequestRef, bundle: EvidenceBundle): Promise<StatusPublication> {
    const outcome = runOutcome(bundle);
    const state = stateByOutcome[outcome];
    const secrets = secretValuesFromEnvironment();
    await sendProviderRequest({
      provider: 'gitea',
      method: 'POST',
      url: `${this.baseUrl}/api/v1/repos/${target.owner}/${target.repo}/statuses/${target.headSha}`,
      token: this.options.token,
      tokenScheme: 'token',
      fetch: this.options.fetch,
      body: {
        state,
        context: this.options.name ?? 'Code Zero',
        description: redactSecrets(evidenceTitle(bundle), secrets).slice(0, MAX_DESCRIPTION),
      },
    });
    return {
      outcome,
      state,
      ...(outcome === 'neutral' || outcome === 'action-required'
        ? { degraded: `Gitea commit statuses have no ${outcome} state; reported ${state}` }
        : {}),
    };
  }
}

export const giteaProvider: SourceControlProvider = {
  kind: 'gitea',
  capabilities,
  recognizes(headers: WebhookHeaders): boolean {
    return (
      readHeader(headers, 'x-gitea-event') !== undefined ||
      readHeader(headers, 'x-forgejo-event') !== undefined
    );
  },
  eventName(headers: WebhookHeaders): string | undefined {
    return readHeader(headers, 'x-gitea-event') ?? readHeader(headers, 'x-forgejo-event');
  },
  verifyWebhook(delivery: WebhookDelivery, secret: string): boolean {
    const signature =
      readHeader(delivery.headers, 'x-gitea-signature') ??
      readHeader(delivery.headers, 'x-forgejo-signature');
    // Gitea and Forgejo sign with bare-hex HMAC-SHA256, without GitHub's `sha256=` prefix.
    return verifyHmacSha256(delivery.body, signature, secret);
  },
  parseReviewEvent: parseGiteaReviewEvent,
  statusPublisher(options: StatusPublisherOptions): StatusPublisher {
    if (options.token.length === 0)
      throw new ProviderConfigurationError('gitea', 'a status token is required');
    if (!options.baseUrl)
      throw new ProviderConfigurationError(
        'gitea',
        'a baseUrl is required for a self-hosted instance',
      );
    return new GiteaStatusPublisher(options, options.baseUrl.replace(TRAILING_SLASH, ''));
  },
};
