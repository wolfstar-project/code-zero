import type {
  EvidenceBundle,
  FeedbackItem,
  IssueRef,
  PullRequestRef,
  ReviewTrigger,
} from '@code-zero/shared';

/** The forges Code Zero connects to in v1. `forges` supports more; they are refused here. */
export const forgeKinds = [
  'github',
  'gitlab',
  'gitea',
  'forgejo',
  'bitbucket',
  'azure-devops',
] as const;
export type ForgeKind = (typeof forgeKinds)[number];

export function isForgeKind(value: unknown): value is ForgeKind {
  return typeof value === 'string' && (forgeKinds as readonly string[]).includes(value);
}

/** One repository on one forge instance. */
export interface ForgeRepository {
  forge: ForgeKind;
  /** Host of the forge deployment, such as `github.com` or `git.example.com`. */
  instance: string;
  /**
   * The forge's namespace: a GitHub or Gitea owner, a GitLab group path, a Bitbucket workspace, or
   * `organization/project` on Azure DevOps.
   */
  owner: string;
  repo: string;
}

/**
 * Identifies the change request a run reports against, in forge-neutral terms.
 *
 * Both commits are read from the forge's own record of the change request rather than from the
 * webhook payload, so `baseSha` is present whenever the forge reports one, and absent rather than
 * guessed when it does not.
 */
export interface ChangeRequestRef extends ForgeRepository {
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

/** A review event normalized away from any forge's payload shape. */
export interface ReviewEvent {
  forge: ForgeKind;
  trigger: Exclude<ReviewTrigger, 'issue'>;
  changeRequest: ChangeRequestRef;
  items: FeedbackItem[];
  /** True when at least one item came from a formal request for changes. */
  requestedChanges: boolean;
}

/** An issue that asked for work, normalized away from any forge's payload shape. */
export interface IssueEvent {
  forge: ForgeKind;
  trigger: 'issue';
  instance: string;
  /** On Azure DevOps a work item belongs to a project, so `repo` is empty there. */
  issue: IssueRef;
  /** Untrusted and bounded before it can reach a prompt or a report. */
  title: string;
  /** Untrusted and bounded before it can reach a prompt or a report. */
  body: string;
  author: string;
  labels: string[];
}

/** The forge-neutral meaning of a finished run for a change request. */
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

/** Where a run outcome ended up on the forge. */
export type StatusSurface = 'check-run' | 'commit-status' | 'comment' | 'none';

/** What a publication actually reported, including any explicit degradation. */
export interface StatusPublication {
  outcome: RunOutcome;
  surface: StatusSurface;
  /** The forge-native state that was recorded, or `unreported`. */
  state: string;
  /** Present when the outcome had no native equivalent on this forge and was mapped. */
  degraded?: string;
}

/**
 * How far one forge supports an operation, as `forges` declares it.
 *
 * `emulated` operations are composed from other calls and `unverified` ones have not been tested
 * against the forge's responses, so callers that care can tell them from `native` ones.
 */
export type CapabilityLevel = 'native' | 'experimental' | 'emulated' | 'unverified' | 'unsupported';

/**
 * What one forge connection can do for Code Zero, derived from `provider.support()`.
 *
 * Every entry is computed from the connection's own provider, so it reflects the credential kind
 * and `readOnly` as well as the forge: an anonymous connection reports every write unsupported.
 */
export interface ForgeCapabilities {
  forge: ForgeKind;
  /** Verifying and translating inbound webhook deliveries. */
  webhooks: CapabilityLevel;
  /** Reading a change request, which is where head and base commits come from. */
  changeRequestReads: CapabilityLevel;
  /** Reading an issue, so issue tasks are possible at all. */
  issueReads: CapabilityLevel;
  /** Listing open change requests, for the poller. */
  discovery: CapabilityLevel;
  /** Reporting a commit status or a check run. */
  statusReporting: CapabilityLevel;
  /** Commenting on a change request. */
  changeRequestComments: CapabilityLevel;
  /** Commenting on an issue. */
  issueComments: CapabilityLevel;
  /** Editing the comment an earlier run left, instead of adding another. */
  stableComments: CapabilityLevel;
  /** Committing a change set to a new branch. */
  commitFiles: CapabilityLevel;
  /** Opening a pull request. */
  pullRequestCreation: CapabilityLevel;
}
