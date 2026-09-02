import type {
  EvidenceBundle,
  FeedbackItem,
  PullRequestRef,
  ReviewTrigger,
} from '@code-zero/shared';

/** Source-control platforms Code Zero can integrate with. */
export const providerKinds = [
  'github',
  'gitlab',
  'bitbucket-cloud',
  'bitbucket-data-center',
  'gitea',
] as const;
export type ProviderKind = (typeof providerKinds)[number];

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && (providerKinds as readonly string[]).includes(value);
}

/**
 * What one provider can actually deliver, so unsupported features degrade explicitly.
 *
 * Every flag is honest about the webhook and API surface the adapter consumes, not about the
 * platform's full feature set: a platform capability the adapter cannot observe is reported as
 * absent rather than assumed.
 */
export interface ProviderCapabilities {
  /** How inbound webhook deliveries are authenticated. */
  webhookAuthentication: 'hmac-sha256' | 'shared-token';
  /** The API surface run evidence is reported through. */
  statusReporting: 'check-runs' | 'commit-status' | 'build-status';
  /** Whether the status vocabulary has a native neutral conclusion. */
  neutralStatus: boolean;
  /** Whether the status vocabulary has a native action-required conclusion. */
  actionRequiredStatus: boolean;
  /** Whether the provider delivers formal review submissions distinct from plain comments. */
  reviewSubmissions: boolean;
  /** Whether ingested feedback can carry a formal request for changes. */
  changeRequests: boolean;
  /** Whether inline comments arrive with file path and line information. */
  inlineComments: boolean;
  /** Whether payloads mark bot authors, so `allowBots: false` can filter them. */
  botAuthorDetection: boolean;
  /** Whether webhook payloads carry the base commit needed for a base-to-head diff. */
  diffBase: boolean;
  /** The provider's own noun for a unit of proposed change, for user-facing text. */
  changeRequestNoun: 'pull request' | 'merge request';
}

/** Case-insensitive HTTP header map of an inbound webhook request. */
export type WebhookHeaders = Readonly<Record<string, string | undefined>>;

/** One inbound webhook request. The body is the raw bytes; signatures verify it verbatim. */
export interface WebhookDelivery {
  body: string;
  headers: WebhookHeaders;
}

/**
 * Identifies the change request a run reports against, in provider-neutral terms.
 *
 * `owner` is the provider's namespace: a GitHub owner, a GitLab namespace path, a Bitbucket
 * workspace or project key, or a Gitea owner. `baseSha` is absent when the provider's webhook
 * payload does not carry a diff base; see `ProviderCapabilities.diffBase`.
 */
export interface ChangeRequestRef {
  provider: ProviderKind;
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  baseSha?: string;
}

/** The complete pull-request reference, for runs that can diff base to head. */
export function toPullRequestRef(ref: ChangeRequestRef): PullRequestRef | undefined {
  if (ref.baseSha === undefined) return undefined;
  const { owner, repo, number, baseSha, headSha } = ref;
  return { owner, repo, number, baseSha, headSha };
}

/** A review event normalized away from any provider's payload shape. */
export interface ReviewEvent {
  provider: ProviderKind;
  trigger: ReviewTrigger;
  changeRequest: ChangeRequestRef;
  items: FeedbackItem[];
  /** True when at least one item came from a formal request for changes. */
  requestedChanges: boolean;
}

export interface ParseOptions {
  /**
   * Logins whose feedback is ignored, normally including the account Code Zero posts as.
   *
   * Without this a run reacts to its own comments and loops.
   */
  ignoreAuthors?: readonly string[];
  /**
   * Whether feedback from bot accounts is ingested. AI reviewers are a first-class source.
   * Only enforceable on providers whose payloads mark bots; see `botAuthorDetection`.
   */
  allowBots?: boolean;
}

/** The provider-neutral meaning of a finished run for a change request. */
export type RunOutcome = 'success' | 'failure' | 'neutral' | 'action-required';

/**
 * Decide what a run means for a change request.
 *
 * Verification is the only thing that produces `success`. A failing check, an unreached terminal
 * state, or an unverified change can never be reported as passing, which is what keeps the
 * published status honest. Rejecting incorrect feedback is a legitimate, neutral outcome rather
 * than a failure: nothing is wrong with the change request.
 */
export function runOutcome(bundle: EvidenceBundle): RunOutcome {
  if (bundle.state === 'failed') return 'failure';
  if (bundle.checks.some((check) => check.exitCode !== 0)) return 'failure';
  if (bundle.state === 'needs-human') return 'action-required';
  if (bundle.verified) return 'success';
  return 'neutral';
}

/** What a status publisher actually reported, including any explicit degradation. */
export interface StatusPublication {
  outcome: RunOutcome;
  /** The provider-native state that was reported. */
  state: string;
  /** Present when the outcome had no native equivalent on this provider and was mapped. */
  degraded?: string;
}

export interface StatusPublisherOptions {
  /** Provider API credential. Sent only as an Authorization header, never logged. */
  token: string;
  /** API base URL. Required for self-hosted providers; cloud providers have a default. */
  baseUrl?: string;
  /** Status or check name, so several Code Zero configurations can report side by side. */
  name?: string;
  fetch?: typeof globalThis.fetch;
}

/** Publishes run evidence as the provider's commit status or check equivalent. */
export interface StatusPublisher {
  publish(target: ChangeRequestRef, bundle: EvidenceBundle): Promise<StatusPublication>;
}

/**
 * One source-control platform behind the provider-neutral boundary.
 *
 * Adapters translate untrusted provider payloads into shared contracts and keep
 * provider-specific URLs, IDs, credentials, and SDK shapes on their side of the boundary.
 */
export interface SourceControlProvider {
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  /** True when the delivery's headers identify this provider. */
  recognizes(headers: WebhookHeaders): boolean;
  /** The provider's event name for a delivery, read from its headers. */
  eventName(headers: WebhookHeaders): string | undefined;
  /** Authenticate a delivery. The raw body is verified, never a re-serialization. */
  verifyWebhook(delivery: WebhookDelivery, secret: string): boolean;
  /** Turn an untrusted payload into a review event, or null when there is nothing to act on. */
  parseReviewEvent(event: string, payload: unknown, options?: ParseOptions): ReviewEvent | null;
  /** Build a status publisher, or throw `ProviderConfigurationError` when misconfigured. */
  statusPublisher(options: StatusPublisherOptions): StatusPublisher;
}

/** A provider was asked for something its configuration cannot support. */
export class ProviderConfigurationError extends Error {
  constructor(
    readonly provider: ProviderKind,
    message: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderConfigurationError';
  }
}
