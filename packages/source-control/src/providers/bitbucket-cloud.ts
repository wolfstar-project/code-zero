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

/**
 * Bitbucket Cloud's `changes_request_created` event carries no text, so a formal request for
 * changes has no claim this adapter can ingest; comments are the reviewable surface. Build
 * statuses have neither a neutral nor an action-required state, so both degrade explicitly.
 */
const capabilities: ProviderCapabilities = {
  webhookAuthentication: 'hmac-sha256',
  statusReporting: 'build-status',
  neutralStatus: false,
  actionRequiredStatus: false,
  reviewSubmissions: false,
  changeRequests: false,
  inlineComments: true,
  botAuthorDetection: false,
  diffBase: true,
  changeRequestNoun: 'pull request',
};

/** Turn a Bitbucket Cloud webhook payload into a review event, or null when nothing is actionable. */
export function parseBitbucketCloudReviewEvent(
  event: string,
  payload: unknown,
  options: ParseOptions = {},
): ReviewEvent | null {
  const record = readRecord(payload);
  if (!record) return null;
  const changeRequest = readChangeRequest(record);
  if (!changeRequest) return null;

  if (event === 'pullrequest:created' || event === 'pullrequest:updated') {
    return {
      provider: 'bitbucket-cloud',
      trigger: 'proactive',
      changeRequest,
      items: [],
      requestedChanges: false,
    };
  }

  if (event !== 'pullrequest:comment_created') return null;
  const comment = readRecord(record.comment);
  if (!comment) return null;
  const user = readRecord(comment.user);
  const author = acceptAuthor(
    readString(user?.nickname) ?? readString(user?.display_name),
    false,
    options,
  );
  const body = readBody(readRecord(comment.content)?.raw);
  if (author === null || body === null) return null;

  const inline = readRecord(comment.inline);
  const path = readString(inline?.path);
  const line = readLine(inline?.to);
  const items: FeedbackItem[] = [
    {
      id: readId(comment.id, 'comment'),
      kind: 'review-comment',
      body,
      author,
      // Bitbucket Cloud's formal "changes requested" signal is a separate, bodyless event.
      requestedChanges: false,
      ...(path === undefined ? {} : { path }),
      ...(line === undefined ? {} : { line }),
    },
  ];
  return {
    provider: 'bitbucket-cloud',
    trigger: 'feedback',
    changeRequest,
    items,
    requestedChanges: false,
  };
}

function readChangeRequest(payload: Record<string, unknown>): ChangeRequestRef | null {
  const pullRequest = readRecord(payload.pullrequest);
  const repository = readRecord(payload.repository);
  if (!pullRequest || !repository) return null;

  const fullName = readString(repository.full_name);
  const number = readPositiveInteger(pullRequest.id);
  const headSha = readSha(readRecord(readRecord(pullRequest.source)?.commit)?.hash);
  // The destination head serves as the diff base; the runner diffs with merge-base semantics.
  const baseSha = readSha(readRecord(readRecord(pullRequest.destination)?.commit)?.hash);
  if (!fullName || number === undefined || !headSha || !baseSha) return null;

  const separator = fullName.indexOf('/');
  if (separator <= 0 || separator === fullName.length - 1) return null;
  return {
    provider: 'bitbucket-cloud',
    owner: fullName.slice(0, separator),
    repo: fullName.slice(separator + 1),
    number,
    headSha,
    baseSha,
  };
}

const stateByOutcome: Record<RunOutcome, string> = {
  success: 'SUCCESSFUL',
  failure: 'FAILED',
  // Build statuses have no neutral or action-required state. A neutral outcome means nothing is
  // wrong with the pull request, so it maps to SUCCESSFUL; a run that needs a human maps to
  // FAILED so the pull request cannot quietly proceed. Both are reported as degraded.
  neutral: 'SUCCESSFUL',
  'action-required': 'FAILED',
};

class BitbucketCloudStatusPublisher implements StatusPublisher {
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
      provider: 'bitbucket-cloud',
      method: 'POST',
      url: `${this.baseUrl}/2.0/repositories/${target.owner}/${target.repo}/commit/${target.headSha}/statuses/build`,
      token: this.options.token,
      tokenScheme: 'Bearer',
      fetch: this.options.fetch,
      body: {
        key: name,
        name,
        state,
        // Bitbucket Cloud requires a URL on build statuses; the pull request itself is the
        // only address this run is guaranteed to have.
        url: `https://bitbucket.org/${target.owner}/${target.repo}/pull-requests/${String(target.number)}`,
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

export const bitbucketCloudProvider: SourceControlProvider = {
  kind: 'bitbucket-cloud',
  capabilities,
  recognizes(headers: WebhookHeaders): boolean {
    return readHeader(headers, 'x-event-key')?.startsWith('pullrequest:') === true;
  },
  eventName(headers: WebhookHeaders): string | undefined {
    return readHeader(headers, 'x-event-key');
  },
  verifyWebhook(delivery: WebhookDelivery, secret: string): boolean {
    const signature = readHeader(delivery.headers, 'x-hub-signature');
    return verifyHmacSha256(delivery.body, signature, secret, 'sha256=');
  },
  parseReviewEvent: parseBitbucketCloudReviewEvent,
  statusPublisher(options: StatusPublisherOptions): StatusPublisher {
    if (options.token.length === 0)
      throw new ProviderConfigurationError('bitbucket-cloud', 'a status token is required');
    return new BitbucketCloudStatusPublisher(
      options,
      options.baseUrl ?? 'https://api.bitbucket.org',
    );
  },
};
