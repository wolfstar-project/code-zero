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
import { timingSafeStringEqual } from '../signatures.js';
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
 * GitLab merge-request webhooks carry the head commit but no diff base, and its commit statuses
 * have neither a neutral nor an action-required state, so both degrade explicitly. Approvals and
 * "request changes" arrive as actions without a reviewable claim, so `changeRequests` is honest
 * about what this adapter can ingest, not about the platform.
 */
const capabilities: ProviderCapabilities = {
  webhookAuthentication: 'shared-token',
  statusReporting: 'commit-status',
  neutralStatus: false,
  actionRequiredStatus: false,
  reviewSubmissions: false,
  changeRequests: false,
  inlineComments: true,
  botAuthorDetection: false,
  diffBase: false,
  changeRequestNoun: 'merge request',
};

/**
 * Turn a GitLab webhook payload into a review event, or null when there is nothing to act on.
 *
 * The event name is matched against both the `X-Gitlab-Event` header form (`Merge Request Hook`)
 * and the payload's `object_kind` spelling, so a caller may pass either. An unknown event name is
 * ignored outright, and a payload whose `object_kind` contradicts the event name is rejected
 * rather than trusted.
 */
export function parseGitLabReviewEvent(
  event: string,
  payload: unknown,
  options: ParseOptions = {},
): ReviewEvent | null {
  const record = readRecord(payload);
  if (!record) return null;
  const kind = normalizeEventName(event);
  if (kind === undefined) return null;
  const objectKind = readString(record.object_kind);
  if (objectKind !== undefined && objectKind !== kind) return null;

  if (kind === 'merge_request') return readMergeRequestEvent(record);
  return readNoteEvent(record, options);
}

function normalizeEventName(event: string): string | undefined {
  const lowered = event.toLowerCase();
  if (lowered === 'merge request hook' || lowered === 'merge_request') return 'merge_request';
  if (lowered === 'note hook' || lowered === 'note') return 'note';
  return undefined;
}

function readMergeRequestEvent(payload: Record<string, unknown>): ReviewEvent | null {
  const attributes = readRecord(payload.object_attributes);
  if (!attributes) return null;
  const action = readString(attributes.action);
  // `update` fires for title and label edits too; `oldrev` is only present when commits changed.
  const proactive =
    action === 'open' ||
    action === 'reopen' ||
    (action === 'update' && readString(attributes.oldrev) !== undefined);
  if (!proactive) return null;

  const changeRequest = readChangeRequest(payload, attributes);
  if (!changeRequest) return null;
  return {
    provider: 'gitlab',
    trigger: 'proactive',
    changeRequest,
    items: [],
    requestedChanges: false,
  };
}

function readNoteEvent(
  payload: Record<string, unknown>,
  options: ParseOptions,
): ReviewEvent | null {
  const attributes = readRecord(payload.object_attributes);
  const mergeRequest = readRecord(payload.merge_request);
  if (!attributes || !mergeRequest) return null;
  if (readString(attributes.noteable_type) !== 'MergeRequest') return null;

  const author = acceptAuthor(readString(readRecord(payload.user)?.username), false, options);
  const body = readBody(attributes.note);
  if (author === null || body === null) return null;

  const changeRequest = readChangeRequest(payload, mergeRequest);
  if (!changeRequest) return null;

  const position = readRecord(attributes.position);
  const path = readString(position?.new_path);
  const line = readLine(position?.new_line);
  const items: FeedbackItem[] = [
    {
      id: readId(attributes.id, 'note'),
      kind: 'review-comment',
      body,
      author,
      // GitLab notes are remarks; formal change requests never reach this adapter as text.
      requestedChanges: false,
      ...(path === undefined ? {} : { path }),
      ...(line === undefined ? {} : { line }),
    },
  ];
  return {
    provider: 'gitlab',
    trigger: 'feedback',
    changeRequest,
    items,
    requestedChanges: false,
  };
}

/**
 * Build the change-request reference from a merge-request record.
 *
 * GitLab does not deliver a base commit in webhook payloads, so the reference carries only the
 * head; runs fall back to runner-side diff discovery (see `capabilities.diffBase`).
 */
function readChangeRequest(
  payload: Record<string, unknown>,
  mergeRequest: Record<string, unknown>,
): ChangeRequestRef | null {
  const project = readRecord(payload.project);
  const pathWithNamespace = readString(project?.path_with_namespace);
  const number = readPositiveInteger(mergeRequest.iid);
  const headSha = readSha(readRecord(mergeRequest.last_commit)?.id);
  if (!pathWithNamespace || number === undefined || !headSha) return null;

  const separator = pathWithNamespace.lastIndexOf('/');
  if (separator <= 0 || separator === pathWithNamespace.length - 1) return null;
  return {
    provider: 'gitlab',
    owner: pathWithNamespace.slice(0, separator),
    repo: pathWithNamespace.slice(separator + 1),
    number,
    headSha,
  };
}

const stateByOutcome: Record<RunOutcome, string> = {
  success: 'success',
  failure: 'failed',
  // GitLab commit statuses have no neutral or action-required state. Nothing is wrong with the
  // merge request on a neutral outcome, so it maps to success; a run that needs a human maps to
  // failed so the merge request cannot quietly proceed. Both are reported as degraded.
  neutral: 'success',
  'action-required': 'failed',
};

class GitLabStatusPublisher implements StatusPublisher {
  constructor(
    private readonly options: StatusPublisherOptions,
    private readonly baseUrl: string,
  ) {}

  async publish(target: ChangeRequestRef, bundle: EvidenceBundle): Promise<StatusPublication> {
    const outcome = runOutcome(bundle);
    const state = stateByOutcome[outcome];
    const project = encodeURIComponent(`${target.owner}/${target.repo}`);
    const secrets = secretValuesFromEnvironment();
    await sendProviderRequest({
      provider: 'gitlab',
      method: 'POST',
      url: `${this.baseUrl}/api/v4/projects/${project}/statuses/${target.headSha}`,
      token: this.options.token,
      tokenScheme: 'Bearer',
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
        ? { degraded: `GitLab commit statuses have no ${outcome} state; reported ${state}` }
        : {}),
    };
  }
}

export const gitlabProvider: SourceControlProvider = {
  kind: 'gitlab',
  capabilities,
  recognizes(headers: WebhookHeaders): boolean {
    return readHeader(headers, 'x-gitlab-event') !== undefined;
  },
  eventName(headers: WebhookHeaders): string | undefined {
    return readHeader(headers, 'x-gitlab-event');
  },
  verifyWebhook(delivery: WebhookDelivery, secret: string): boolean {
    // GitLab authenticates with a shared token rather than a body signature.
    return (
      secret.length > 0 &&
      timingSafeStringEqual(readHeader(delivery.headers, 'x-gitlab-token'), secret)
    );
  },
  parseReviewEvent: parseGitLabReviewEvent,
  statusPublisher(options: StatusPublisherOptions): StatusPublisher {
    if (options.token.length === 0)
      throw new ProviderConfigurationError('gitlab', 'a status token is required');
    return new GitLabStatusPublisher(options, options.baseUrl ?? 'https://gitlab.com');
  },
};
