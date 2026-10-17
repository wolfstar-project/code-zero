import { randomUUID } from 'node:crypto';

/** Package version injected from package.json by tsdown at build time. */
export const version: string = '[VI]{{inject}}[/VI]';

export {
  evidenceFromResult,
  evidenceTitle,
  renderEvidenceMarkdown,
  type EvidenceBundle,
  type RenderEvidenceOptions,
} from './evidence.js';
export {
  REDACTED,
  redactSecrets,
  secretValuesFromEnvironment,
  truncateHead,
  truncateTail,
} from './redact.js';
export {
  allChecksPassed,
  emptyTaskUsage,
  isRepositoryRelativePath,
  type AgentDecision,
  type ChangeRisk,
  type CheckResult,
  type FeedbackItem,
  type FeedbackKind,
  type Finding,
  type IssueRef,
  type ModelFinding,
  type ModelCallUsage,
  type ModelProviderCredentialKind,
  type ModelProviderKind,
  type NetworkPolicy,
  type ProposedChange,
  type PullRequestRef,
  type ReviewInput,
  type ReviewTrigger,
  type RunMode,
  type RunnerDescription,
  type Severity,
  type TaskEvent,
  type TaskResult,
  type TaskState,
  type TaskUsage,
  type TerminalState,
  type Verdict,
} from './types.js';

export const now = (): string => new Date().toISOString();
export const taskId = (): string => `cz_${randomUUID()}`;
