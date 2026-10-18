import {
  redactSecrets,
  renderEvidenceMarkdown,
  secretValuesFromEnvironment,
  truncateHead,
  type EvidenceBundle,
} from '@code-zero/shared';

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
 *
 * `issueReference` is how the forge links the issue from a pull request body (`#7` on most forges),
 * so the pull request closes the issue it answers.
 */
export function prepareIssuePullRequest(
  bundle: EvidenceBundle,
  issueReference = bundle.issue ? `#${String(bundle.issue.number)}` : '',
): PullRequestReadiness {
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
    `Closes ${issueReference}.`,
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

/**
 * Compose the validation verdict a finished issue run reports back on its issue.
 *
 * Before any change is trusted, the runtime decided from repository evidence whether the issue
 * reports a real problem, and this comment carries that verdict — confirmed with its evidence, not
 * confirmed with every rejection reason, or inconclusive with what a human should look at. It is
 * derived only from the persisted evidence bundle, so it can never claim more than the run proved,
 * and a run that failed before producing a verdict gets no comment rather than a misleading one.
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
  const lines: string[] = ['### Code Zero — issue validation', ''];

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
