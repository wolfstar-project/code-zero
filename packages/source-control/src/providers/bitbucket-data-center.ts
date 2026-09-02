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
  readLine,
  readPositiveInteger,
  readRecord,
  readSha,
  readString,
} from '../untrusted.js';

const MAX_DESCRIPTION = 1_000;
const TRAILING_SLASH = /\/$/u;

/**
 * Bitbucket Data Center's `pr:reviewer:needs_work` event carries no text, so a formal request
 * for changes has no claim this adapter can ingest. Comment webhooks do not reliably deliver an
 * inline anchor, so path and line are read when present but not promised.
 */
const capabilities: ProviderCapabilities = {
  webhookAuthentication: 'hmac-sha256',
  statusReporting: 'build-status',
  neutralStatus: false,
  actionRequiredStatus: false,
  reviewSubmissions: false,
  changeRequests: false,
  inlineComments: false,
  botAuthorDetection: false,
  diffBase: true,
  changeRequestNoun: 'pull request',
};

/** Turn a Bitbucket Data Center webhook payload into a review event, or null when nothing is actionable. */
export function parseBitbucketDataCenterReviewEvent(
  event: string,
  payload: unknown,
  options: ParseOptions = {},
): ReviewEvent | null {
  const record = readRecord(payload);
  if (!record) return null;
  const changeRequest = readChangeRequest(record);
  if (!changeRequest) return null;

  // `pr:modified` fires for title and description edits, which introduce no reviewable diff.
  if (event === 'pr:opened' || event === 'pr:from_ref_updated') {
    return {
      provider: 'bitbucket-data-center',
      trigger: 'proactive',
      changeRequest,
      items: [],
      requestedChanges: false,
    };
  }

  if (event !== 'pr:comment:added') return null;
  const comment = readRecord(record.comment);
  if (!comment) return null;
  const authorRecord = readRecord(comment.author);
  const author = acceptAuthor(
    readString(authorRecord?.name) ?? readString(authorRecord?.displayName),
    false,
    options,
  );
  const body = readBody(comment.text);
  if (author === null || body === null) return null;

  // The inline anchor is not part of the documented payload everywhere; read it when present.
  const anchor = readRecord(comment.anchor) ?? readRecord(record.commentAnchor);
  const path = readString(anchor?.path);
  const line = readLine(anchor?.line);
  const items: FeedbackItem[] = [
    {
      id: readId(comment.id, 'comment'),
      kind: 'review-comment',
      body,
      author,
      // The formal "needs work" signal is a separate, bodyless event.
      requestedChanges: false,
      ...(path === undefined ? {} : { path }),
      ...(line === undefined ? {} : { line }),
    },
  ];
  return {
    provider: 'bitbucket-data-center',
    trigger: 'feedback',
    changeRequest,
    items,
    requestedChanges: false,
  };
}

function readChangeRequest(payload: Record<string, unknown>): ChangeRequestRef | null {
  const pullRequest = readRecord(payload.pullRequest);
  if (!pullRequest) return null;
  const fromRef = readRecord(pullRequest.fromRef);
  const toRef = readRecord(pullRequest.toRef);
  const repository = readRecord(toRef?.repository);
  if (!fromRef || !toRef || !repository) return null;

  const number = readPositiveInteger(pullRequest.id);
  const headSha = readSha(fromRef.latestCommit);
  // The target head serves as the diff base; the runner diffs with merge-base semantics.
  const baseSha = readSha(toRef.latestCommit);
  const repo = readString(repository.slug);
  const owner = readString(readRecord(repository.project)?.key);
  if (number === undefined || !headSha || !baseSha || !repo || !owner) return null;
  return { provider: 'bitbucket-data-center', owner, repo, number, headSha, baseSha };
}

const stateByOutcome: Record<RunOutcome, string> = {
  success: 'SUCCESSFUL',
  failure: 'FAILED',
  // Build statuses have no neutral or action-required state; see the Cloud adapter for the
  // rationale behind these mappings. Both are reported as degraded.
  neutral: 'SUCCESSFUL',
  'action-required': 'FAILED',
};

class BitbucketDataCenterStatusPublisher implements StatusPublisher {
  constructor(
    private readonly options: StatusPublisherOptions,
    private readonly baseUrl: string,
  ) {}

  async publish(target: ChangeRequestRef, bundle: EvidenceBundle): Promise<StatusPublication> {
    const outcome = runOutcome(bundle);
    const state = stateByOutcome[outcome];
    const name = this.options.name ?? 'Code Zero';
    const secrets = secretValuesFromEnvironment();
    await sendProviderRequest({
      provider: 'bitbucket-data-center',
      method: 'POST',
      url: `${this.baseUrl}/rest/api/latest/projects/${target.owner}/repos/${target.repo}/commits/${target.headSha}/builds`,
      token: this.options.token,
      tokenScheme: 'Bearer',
      fetch: this.options.fetch,
      body: {
        key: name,
        name,
        state,
        url: `${this.baseUrl}/projects/${target.owner}/repos/${target.repo}/pull-requests/${String(target.number)}`,
        description: redactSecrets(evidenceTitle(bundle), secrets).slice(0, MAX_DESCRIPTION),
      },
    });
    return {
      outcome,
      state,
      ...(outcome === 'neutral' || outcome === 'action-required'
        ? { degraded: `Bitbucket build statuses have no ${outcome} state; reported ${state}` }
        : {}),
    };
  }
}

export const bitbucketDataCenterProvider: SourceControlProvider = {
  kind: 'bitbucket-data-center',
  capabilities,
  recognizes(headers: WebhookHeaders): boolean {
    return readHeader(headers, 'x-event-key')?.startsWith('pr:') === true;
  },
  eventName(headers: WebhookHeaders): string | undefined {
    return readHeader(headers, 'x-event-key');
  },
  verifyWebhook(delivery: WebhookDelivery, secret: string): boolean {
    const signature = readHeader(delivery.headers, 'x-hub-signature');
    return verifyHmacSha256(delivery.body, signature, secret, 'sha256=');
  },
  parseReviewEvent: parseBitbucketDataCenterReviewEvent,
  statusPublisher(options: StatusPublisherOptions): StatusPublisher {
    if (options.token.length === 0)
      throw new ProviderConfigurationError('bitbucket-data-center', 'a status token is required');
    if (!options.baseUrl)
      throw new ProviderConfigurationError(
        'bitbucket-data-center',
        'a baseUrl is required for a self-hosted instance',
      );
    return new BitbucketDataCenterStatusPublisher(
      options,
      options.baseUrl.replace(TRAILING_SLASH, ''),
    );
  },
};
