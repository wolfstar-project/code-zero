import { redactSecrets, truncateHead, truncateTail } from './redact.js';
import type {
  CheckResult,
  Finding,
  IssueRef,
  ReviewInput,
  ReviewTrigger,
  RunMode,
  RunnerDescription,
  TaskEvent,
  TaskResult,
  TerminalState,
  Verdict,
} from './types.js';

/**
 * The durable record of a run, preserved for accepted and rejected findings alike.
 *
 * A bundle is derived only from values a run already observed. Nothing here is generated at render
 * time, so the same result always produces the same bundle and the same report.
 */
export interface EvidenceBundle {
  taskId: string;
  state: TerminalState;
  verdict: Verdict;
  verified: boolean;
  mode: RunMode;
  trigger: ReviewTrigger;
  source: string | null;
  /** The GitHub issue an issue-to-PR run worked on, kept so reports can link back to it. */
  issue: IssueRef | null;
  runner: RunnerDescription;
  finding: Finding | null;
  plan: string[];
  /** Verifiable completion conditions recorded for an issue task. */
  acceptanceCriteria: string[];
  changedFiles: string[];
  checks: CheckResult[];
  attempts: number;
  transitions: TaskEvent[];
  summary: string;
}

/** Build the evidence bundle for a finished run. */
export function evidenceFromResult(
  result: TaskResult,
  input: Pick<ReviewInput, 'mode' | 'source' | 'trigger' | 'issue'>,
): EvidenceBundle {
  return {
    taskId: result.id,
    state: result.state,
    verdict: result.verdict,
    verified: result.verified,
    mode: input.mode,
    trigger: input.trigger ?? 'feedback',
    source: input.source ?? null,
    issue: input.issue ? { ...input.issue } : null,
    runner: result.runner,
    finding: result.finding,
    plan: [...result.plan],
    acceptanceCriteria: [...result.acceptanceCriteria],
    changedFiles: [...result.changedFiles],
    checks: [...result.checks],
    attempts: result.attempts,
    transitions: [...result.events],
    summary: result.summary,
  };
}

export interface RenderEvidenceOptions {
  /** Hard ceiling for the rendered document. Defaults below the GitHub check output limit. */
  maxLength?: number;
  /** Extra literal values to substitute, usually credentials read from the environment. */
  secrets?: readonly string[];
  /** Characters of captured output to keep per failing check. */
  maxCheckOutput?: number;
}

const DEFAULT_MAX_LENGTH = 60_000;
const DEFAULT_MAX_CHECK_OUTPUT = 2_000;
const MAX_EXPLANATION = 4_000;

/**
 * Render a bundle as deterministic Markdown for GitHub checks and terminal output.
 *
 * The report states plainly whether verification passed. A run that did not verify is never
 * described as verified, and credentials are removed before the document is assembled.
 */
export function renderEvidenceMarkdown(
  bundle: EvidenceBundle,
  options: RenderEvidenceOptions = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const maxCheckOutput = options.maxCheckOutput ?? DEFAULT_MAX_CHECK_OUTPUT;
  const secrets = options.secrets ?? [];
  const clean = (text: string): string => redactSecrets(text, secrets);

  const lines: string[] = [
    `## Code Zero — ${triggerLabel(bundle.trigger)} ${bundle.verdict}`,
    '',
    clean(bundle.summary),
    '',
    '| Property | Value |',
    '| --- | --- |',
    `| Task | \`${bundle.taskId}\` |`,
    `| Mode | \`${bundle.mode}\` |`,
    `| Trigger | \`${bundle.trigger}\` |`,
    `| Terminal state | \`${bundle.state}\` |`,
    `| Verification | ${verificationLabel(bundle)} |`,
    `| Repair attempts | ${String(bundle.attempts)} |`,
    `| Runner | ${runnerLabel(bundle.runner)} |`,
    `| Source | ${bundle.source === null ? 'local' : `\`${clean(bundle.source)}\``} |`,
    '',
  ];

  if (bundle.finding) {
    const finding = bundle.finding;
    lines.push(
      '### Finding',
      '',
      `**${clean(finding.title)}** — severity \`${finding.severity}\`, model confidence \`${finding.confidence.toFixed(2)}\`, change risk \`${finding.changeRisk}\``,
      '',
      clean(truncateHead(finding.explanation, MAX_EXPLANATION)),
      '',
    );
    lines.push(...list('Evidence cited', finding.evidence.map(clean)));
    lines.push(...list('Files cited', finding.files.map(inlineCode)));
    lines.push(...list('Why this was not accepted', finding.rejectionReasons.map(clean)));
  } else {
    lines.push('### Finding', '', 'No finding was produced.', '');
  }

  lines.push(...list('Acceptance criteria', bundle.acceptanceCriteria.map(clean)));
  lines.push(...list('Plan', bundle.plan.map(clean)));
  lines.push(...list('Changed files', bundle.changedFiles.map(inlineCode)));

  if (bundle.checks.length > 0) {
    lines.push('### Checks', '', '| Command | Exit code | Duration |', '| --- | --- | --- |');
    for (const check of bundle.checks)
      lines.push(
        `| \`${cell(clean(check.command))}\` | ${String(check.exitCode)} | ${String(check.durationMs)} ms |`,
      );
    lines.push('');
    for (const check of bundle.checks) {
      if (check.exitCode === 0) continue;
      const output = truncateTail(`${check.stdout}\n${check.stderr}`.trim(), maxCheckOutput);
      lines.push(
        `<details><summary>Output of <code>${cell(clean(check.command))}</code></summary>`,
        '',
        '```text',
        clean(output),
        '```',
        '',
        '</details>',
        '',
      );
    }
  } else {
    lines.push('### Checks', '', 'No repository-native checks were executed.', '');
  }

  lines.push('### Lifecycle', '', '| State | Attempt | Detail |', '| --- | --- | --- |');
  for (const event of bundle.transitions)
    lines.push(
      `| \`${event.state}\` | ${event.attempt === undefined ? '—' : String(event.attempt)} | ${cell(clean(event.message))} |`,
    );

  return truncateHead(`${lines.join('\n')}\n`, maxLength).slice(0, maxLength);
}

/** One-line title for a GitHub check run or terminal header. */
export function evidenceTitle(bundle: EvidenceBundle): string {
  return `${verdictLabel(bundle.trigger, bundle.verdict)} · ${verificationLabel(bundle)}`;
}

function triggerLabel(trigger: ReviewTrigger): string {
  if (trigger === 'proactive') return 'proactive finding';
  if (trigger === 'issue') return 'issue task';
  return 'feedback';
}

function verdictLabel(trigger: ReviewTrigger, verdict: Verdict): string {
  const subject = trigger === 'issue' ? 'Issue task' : 'Feedback';
  if (verdict === 'accepted') return `${subject} accepted`;
  if (verdict === 'rejected') return `${subject} rejected`;
  return `${subject} inconclusive`;
}

function verificationLabel(bundle: EvidenceBundle): string {
  if (bundle.verified) return `passed (${String(bundle.checks.length)} checks)`;
  const failed = bundle.checks.filter((check) => check.exitCode !== 0).length;
  if (failed > 0) return `failed (${String(failed)} of ${String(bundle.checks.length)} checks)`;
  return 'not performed';
}

function runnerLabel(runner: RunnerDescription): string {
  const isolation = runner.isolated ? 'isolated' : 'not isolated';
  const access = runner.writable ? 'read-write' : 'read-only';
  return `\`${runner.kind}\` (${isolation}, ${access}, network \`${runner.network}\`)`;
}

function list(heading: string, items: readonly string[]): string[] {
  if (items.length === 0) return [];
  return [`### ${heading}`, '', ...items.map((item) => `- ${cell(item)}`), ''];
}

function inlineCode(value: string): string {
  return `\`${value}\``;
}

/** Collapse a value so it cannot break out of a Markdown table row. */
function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ').trim();
}
