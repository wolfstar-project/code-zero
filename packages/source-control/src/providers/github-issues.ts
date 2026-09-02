import {
  redactSecrets,
  renderEvidenceMarkdown,
  secretValuesFromEnvironment,
  truncateHead,
  type EvidenceBundle,
  type IssueRef,
  type ReviewInput,
  type RunMode,
} from '@code-zero/shared';

import { assertSafeBranchName } from './github-pulls.js';

/** Webhook event name the issue-to-PR workflow understands. */
export const supportedIssueEvents = ['issues'] as const;

/** A scoped issue task normalized away from GitHub's payload shape. */
export interface IssueTask {
  issue: IssueRef;
  title: string;
  /** Untrusted issue body, bounded before it can reach a prompt or a report. */
  body: string;
  author: string;
  labels: string[];
}

export interface ParseIssueOptions {
  /**
   * Label an issue must carry before it becomes a task. Scoping is explicit: without the label an
   * issue is ignored, so arbitrary issue text cannot start a run on its own.
   */
  requireLabel?: string;
  /** Logins whose issues are ignored, normally including the account Code Zero posts as. */
  ignoreAuthors?: readonly string[];
  /** Whether issues opened by bot accounts are ingested. */
  allowBots?: boolean;
}

/** Untrusted issue titles and bodies are bounded before they reach a prompt or a report. */
const MAX_TITLE = 300;
const MAX_BODY = 20_000;

/**
 * Turn a GitHub `issues` webhook payload into an issue task, or null when there is nothing to act
 * on.
 *
 * The payload is untrusted, so every field is checked rather than asserted. Only an open, labeled
 * issue produces a task: closing, unlabeling, and comment activity carry no work, and a pull
 * request masquerading as an issue (GitHub models PRs as issues) is refused.
 */
export function parseIssueTask(
  event: string,
  payload: unknown,
  options: ParseIssueOptions = {},
): IssueTask | null {
  if (event !== 'issues' || !isRecord(payload)) return null;
  if (payload.action !== 'opened' && payload.action !== 'labeled' && payload.action !== 'reopened')
    return null;

  const issue = isRecord(payload.issue) ? payload.issue : undefined;
  const repository = isRecord(payload.repository) ? payload.repository : undefined;
  if (!issue || !repository) return null;
  if ('pull_request' in issue && issue.pull_request !== undefined && issue.pull_request !== null)
    return null;
  if (issue.state !== 'open') return null;

  const number =
    typeof issue.number === 'number' && Number.isInteger(issue.number) && issue.number > 0
      ? issue.number
      : undefined;
  const repo = typeof repository.name === 'string' ? repository.name : undefined;
  const ownerRecord = isRecord(repository.owner) ? repository.owner : undefined;
  const owner = typeof ownerRecord?.login === 'string' ? ownerRecord.login : undefined;
  if (number === undefined || !repo || !owner) return null;

  const author = readAuthor(issue.user, options);
  const title = typeof issue.title === 'string' ? issue.title.trim().slice(0, MAX_TITLE) : '';
  if (author === null || title.length === 0) return null;
  const body = typeof issue.body === 'string' ? issue.body.trim().slice(0, MAX_BODY) : '';

  const labels = readLabels(issue.labels);
  const required = options.requireLabel?.trim() ?? '';
  if (
    required.length > 0 &&
    !labels.some((label) => label.toLowerCase() === required.toLowerCase())
  )
    return null;

  return { issue: { owner, repo, number }, title, body, author, labels };
}

/**
 * Build runtime input for an issue task.
 *
 * The mode is supplied by the caller and defaults to `observe`, so an inbound webhook can never
 * escalate a run into writing to a repository on its own. The issue text travels as untrusted
 * feedback for the runtime to validate, never as instructions.
 */
export function issueInputFromTask(
  task: IssueTask,
  options: { checkoutPath: string; mode?: RunMode },
): ReviewInput {
  const { owner, repo, number } = task.issue;
  const header = `[issue #${String(number)} by ${task.author}] ${task.title}`;
  return {
    repository: options.checkoutPath,
    mode: options.mode ?? 'observe',
    trigger: 'issue',
    source: `github:${owner}/${repo}#${String(number)}`,
    feedback: task.body.length === 0 ? header : `${header}\n\n${task.body}`,
    issue: { ...task.issue },
  };
}

/**
 * The isolated branch a verified issue task publishes its changes on.
 *
 * The name is assembled only from operator policy (the prefix), the issue number, and the
 * runtime-generated task identifier — never from issue text — and is still validated as a whole
 * so no input combination can produce unexpected ref syntax.
 */
export function issueBranchName(prefix: string, issue: IssueRef, taskIdentifier: string): string {
  const suffix = taskIdentifier
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  const name = `${prefix}issue-${String(issue.number)}${suffix.length > 0 ? `-${suffix}` : ''}`;
  assertSafeBranchName(name);
  return name;
}

export type PullRequestReadiness =
  | { ready: true; title: string; body: string }
  | { ready: false; reason: string };

const MAX_PR_TITLE = 120;
const MAX_PR_BODY = 60_000;

/**
 * Decide whether a finished run has earned a pull request, and compose it when it has.
 *
 * This is the single home of the issue-to-PR publication gate: a pull request is composed only
 * from a completed issue run whose changes were applied and verified by the repository's own
 * checks. High-impact changes never reach this point autonomously — the runtime already stops them
 * at `needs-human` — but the class is re-checked here so a defect upstream still cannot publish
 * one. The body never claims more than the evidence supports because it is the evidence.
 */
export function prepareIssuePullRequest(bundle: EvidenceBundle): PullRequestReadiness {
  if (bundle.trigger !== 'issue')
    return { ready: false, reason: 'Only an issue-triggered run can open an issue pull request.' };
  if (!bundle.issue)
    return { ready: false, reason: 'The run does not reference the issue it worked on.' };
  if (bundle.state === 'needs-human')
    return { ready: false, reason: 'The run is waiting for human approval.' };
  if (bundle.state !== 'completed')
    return { ready: false, reason: `The run finished in state ${bundle.state}, not completed.` };
  if (bundle.verdict !== 'accepted')
    return { ready: false, reason: 'The issue task was not accepted by validation.' };
  if (!bundle.verified)
    return { ready: false, reason: 'The changes were not verified by repository checks.' };
  if (bundle.changedFiles.length === 0)
    return { ready: false, reason: 'The run changed no files, so there is nothing to publish.' };
  if (!bundle.finding) return { ready: false, reason: 'The run produced no finding to describe.' };
  if (bundle.finding.changeRisk === 'high-impact')
    return { ready: false, reason: 'High-impact changes always require human approval.' };

  const secrets = secretValuesFromEnvironment();
  const clean = (text: string): string => redactSecrets(text, secrets);
  const title = clean(bundle.finding.title).slice(0, MAX_PR_TITLE);
  const lines = [
    `Closes #${String(bundle.issue.number)}.`,
    '',
    clean(bundle.summary),
    '',
    renderEvidenceMarkdown(bundle, { maxLength: MAX_PR_BODY - 2_000, secrets }),
  ];
  return { ready: true, title, body: truncateHead(lines.join('\n'), MAX_PR_BODY) };
}

export type IssueValidationComment =
  | { ready: true; body: string }
  | { ready: false; reason: string };

const MAX_COMMENT_BODY = 30_000;
const MAX_COMMENT_ITEMS = 10;

/** Marker embedded in every validation comment so later automation can recognize its own output. */
export const VALIDATION_COMMENT_MARKER = '<!-- code-zero:issue-validation -->';

/**
 * Compose the validation verdict a finished issue run reports back on its issue.
 *
 * This is the triage step made visible: before any change is trusted, the runtime decided from
 * repository evidence whether the issue actually reports a real problem, and this comment carries
 * that verdict — confirmed with its evidence, not confirmed with every rejection reason, or
 * inconclusive with what a human should look at. The comment is derived only from the persisted
 * evidence bundle, so it can never claim more than the run proved, and a run that failed before
 * producing a verdict gets no comment rather than a misleading one.
 */
export function prepareIssueValidationComment(bundle: EvidenceBundle): IssueValidationComment {
  if (bundle.trigger !== 'issue')
    return { ready: false, reason: 'Only an issue-triggered run can report issue validation.' };
  if (!bundle.issue)
    return { ready: false, reason: 'The run does not reference the issue it worked on.' };
  if (bundle.state === 'failed')
    return {
      ready: false,
      reason: 'The run failed before reaching a verdict, so there is nothing to report.',
    };

  const secrets = secretValuesFromEnvironment();
  const clean = (text: string): string => redactSecrets(text, secrets);
  const finding = bundle.finding;
  const lines: string[] = [VALIDATION_COMMENT_MARKER, `### Code Zero — issue validation`, ''];

  if (bundle.verdict === 'accepted') {
    lines.push(
      '**Confirmed.** Repository evidence supports this report.',
      '',
      clean(bundle.summary),
    );
    if (finding) {
      lines.push(...commentList('Evidence', finding.evidence.map(clean)));
      lines.push(...commentList('Files', finding.files.map(inlineCode)));
    }
    lines.push(...commentList('Acceptance criteria', bundle.acceptanceCriteria.map(clean)));
    if (bundle.verified && bundle.changedFiles.length > 0)
      lines.push('', 'A verified fix was prepared; see the linked pull request for the evidence.');
  } else if (bundle.verdict === 'rejected') {
    lines.push(
      '**Not confirmed.** The report is not supported by the repository.',
      '',
      clean(bundle.summary),
    );
    if (finding) lines.push(...commentList('Why', finding.rejectionReasons.map(clean)));
  } else {
    lines.push(
      '**Inconclusive.** The evidence was not sufficient to confirm or reject this report; a human should take a look.',
      '',
      clean(bundle.summary),
    );
    if (finding)
      lines.push(...commentList('What was checked', finding.rejectionReasons.map(clean)));
  }

  lines.push('', `_Task \`${bundle.taskId}\`; validation is evidence-based and report-only._`);
  return { ready: true, body: truncateHead(lines.join('\n'), MAX_COMMENT_BODY) };
}

function commentList(heading: string, items: readonly string[]): string[] {
  if (items.length === 0) return [];
  const kept = items.slice(0, MAX_COMMENT_ITEMS);
  const lines = ['', `**${heading}**`, '', ...kept.map((item) => `- ${collapse(item)}`)];
  if (items.length > kept.length)
    lines.push(`- … and ${String(items.length - kept.length)} more in the task evidence`);
  return lines;
}

function inlineCode(value: string): string {
  return `\`${value}\``;
}

const LINE_BREAKS = /\r?\n/g;

/** Collapse a value onto one line so an item cannot restructure the surrounding Markdown. */
function collapse(value: string): string {
  return value.replaceAll(LINE_BREAKS, ' ').trim();
}

function readAuthor(user: unknown, options: ParseIssueOptions): string | null {
  if (!isRecord(user)) return null;
  const login = typeof user.login === 'string' ? user.login : '';
  if (login.length === 0) return null;
  const ignored = options.ignoreAuthors ?? [];
  if (ignored.some((ignore) => ignore.toLowerCase() === login.toLowerCase())) return null;
  if (options.allowBots === false && user.type === 'Bot') return null;
  return login;
}

function readLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.name === 'string' && entry.name.length > 0)
      labels.push(entry.name);
  }
  return labels;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
