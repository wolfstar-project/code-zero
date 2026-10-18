import {
  isRepositoryRelativePath,
  type FeedbackItem,
  type ReviewInput,
  type RunMode,
} from '@code-zero/shared';

import {
  toPullRequestRef,
  type ChangeRequestRef,
  type IssueEvent,
  type ReviewEvent,
} from './contracts.js';

/** A stable, forge-qualified label for where a run came from. */
export function sourceLabel(ref: ChangeRequestRef): string {
  // GitLab writes merge requests as `!7`; everyone else numbers change requests with `#`.
  const separator = ref.forge === 'gitlab' ? '!' : '#';
  return `${ref.forge}:${ref.owner}/${ref.repo}${separator}${String(ref.number)}`;
}

/**
 * Build runtime input for a review event.
 *
 * The mode is supplied by the caller and defaults to `observe`, so an inbound webhook can never
 * escalate a run into writing to a repository on its own. The pull-request reference is attached
 * only when the forge reported a diff base; without one the run falls back to the runner's own
 * diff discovery instead of trusting a partial range.
 */
export function reviewInputFromEvent(
  event: ReviewEvent,
  options: { checkoutPath: string; mode?: RunMode },
): ReviewInput {
  const pullRequest = toPullRequestRef(event.changeRequest);
  const files = [
    ...new Set(
      event.items
        .map((item) => item.path)
        .filter((path): path is string => path !== undefined && isRepositoryRelativePath(path)),
    ),
  ];
  return {
    repository: options.checkoutPath,
    mode: options.mode ?? 'observe',
    trigger: event.trigger,
    source: sourceLabel(event.changeRequest),
    ...(pullRequest ? { pullRequest } : {}),
    ...(event.trigger === 'feedback'
      ? { feedback: renderFeedback(event.items), items: event.items }
      : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}

/**
 * Build runtime input for an issue task.
 *
 * The mode defaults to `observe` for the same reason as review input, and the issue text travels
 * as untrusted feedback for the runtime to validate, never as instructions.
 */
export function issueInputFromEvent(
  event: IssueEvent,
  options: { checkoutPath: string; mode?: RunMode },
): ReviewInput {
  const { owner, repo, number } = event.issue;
  const header = `[issue #${String(number)} by ${event.author}] ${event.title}`;
  const path = repo.length > 0 ? `${owner}/${repo}` : owner;
  return {
    repository: options.checkoutPath,
    mode: options.mode ?? 'observe',
    trigger: 'issue',
    source: `${event.forge}:${path}#${String(number)}`,
    feedback: event.body.length === 0 ? header : `${header}\n\n${event.body}`,
    issue: { ...event.issue },
  };
}

/** A single human-readable transcript of the review, used when no structured items are consumed. */
export function renderFeedback(items: readonly FeedbackItem[]): string {
  return items
    .map((item) => {
      const location = item.path
        ? ` on ${item.path}${item.line === undefined ? '' : `:${String(item.line)}`}`
        : '';
      const kind = item.requestedChanges ? `${item.kind} (changes requested)` : item.kind;
      return `[${kind} by ${item.author}${location}]\n${item.body}`;
    })
    .join('\n\n---\n\n');
}
