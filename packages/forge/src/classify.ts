import type { FeedbackItem } from '@code-zero/shared';
import type { EventAction, EventKind, ForgeEvent, ThreadRef } from 'forges';

import { MAX_FEEDBACK_BODY, readBody, refuseAuthor, type AuthorFilter } from './untrusted.js';

/** What one normalized event asks Code Zero to do, before any thread is read. */
export type Classification =
  | { type: 'proactive'; thread: ThreadRef }
  | { type: 'feedback'; thread: ThreadRef; item: FeedbackItem }
  | { type: 'issue'; thread: ThreadRef }
  | { type: 'ignore'; reason: string };

/**
 * Change-request actions that put a new head in front of reviewers.
 *
 * `edited` is left out on purpose: GitHub sends it for a title change, and Bitbucket and Azure
 * DevOps send it for both a push and a title change, so it cannot tell new code from new prose.
 * The poller still notices a new head on those forges.
 */
const PROACTIVE_ACTIONS: ReadonlySet<EventAction> = new Set<EventAction>([
  'opened',
  'created',
  'reopened',
  'synchronised',
  'ready_for_review',
]);

/** Issue actions after which an issue may carry the label that asks for work. */
const ISSUE_ACTIONS: ReadonlySet<EventAction> = new Set<EventAction>([
  'opened',
  'created',
  'reopened',
  'labelled',
  'edited',
]);

const FEEDBACK_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'review',
  'review_comment',
  'comment',
]);

const ignore = (reason: string): Classification => ({ type: 'ignore', reason });

/** Decide what an event asks for. The payload is untrusted; only normalized fields are read. */
export function classifyEvent(event: ForgeEvent, filter: AuthorFilter): Classification {
  const thread = event.thread;
  if (!thread || thread.number === undefined)
    return ignore('the event names no issue or change request');
  if (thread.kind === 'pull_request') return classifyChangeRequestEvent(event, thread, filter);
  if (thread.kind === 'issue') return classifyIssueEvent(event, thread);
  return ignore(`a ${thread.kind} thread carries no work`);
}

function classifyChangeRequestEvent(
  event: ForgeEvent,
  thread: ThreadRef,
  filter: AuthorFilter,
): Classification {
  if (!FEEDBACK_KINDS.has(event.kind)) {
    if (event.kind === 'label' || !PROACTIVE_ACTIONS.has(event.action))
      return ignore(`a ${event.kind} ${event.action} event asks for no review`);
    return { type: 'proactive', thread };
  }
  // Who spoke is decided before what they said, so an ignored account is ignored on every forge,
  // including the ones whose deliveries arrive without the text.
  const refused = refuseAuthor(event.actor, filter);
  if (refused !== null) return ignore(refused);
  const author = event.actor?.login ?? '';
  const { detail } = event;
  if (detail?.type === 'review') {
    if (detail.state !== 'changes_requested' && detail.state !== 'commented')
      return ignore(`a ${detail.state} review carries no claim to validate`);
    return feedback(thread, detail.body, {
      id: `review:${event.id}`,
      kind: 'review-body',
      author,
      requestedChanges: detail.state === 'changes_requested',
    });
  }
  if (detail?.type === 'review_comment' || detail?.type === 'comment') {
    if (event.action !== 'created') return ignore(`an ${event.action} comment is not new feedback`);
    const path = detail.type === 'review_comment' ? detail.path : undefined;
    const line = detail.type === 'review_comment' ? detail.line : undefined;
    return feedback(thread, detail.body, {
      id: `comment:${detail.comment?.id ?? event.id}`,
      kind: 'review-comment',
      author,
      // A single comment is a remark; only a review decides on changes.
      requestedChanges: false,
      ...(path === undefined ? {} : { path }),
      ...(line === undefined ? {} : { line }),
    });
  }
  return ignore(`${event.forge} delivered this ${event.kind} without its text`);
}

function feedback(
  thread: ThreadRef,
  text: string | undefined,
  item: Omit<FeedbackItem, 'body'>,
): Classification {
  const body = readBody(text, MAX_FEEDBACK_BODY);
  if (body === null) return ignore('the feedback has no text to validate');
  return { type: 'feedback', thread, item: { ...item, body } };
}

function classifyIssueEvent(event: ForgeEvent, thread: ThreadRef): Classification {
  if (event.kind !== 'state_change' && event.kind !== 'label')
    return ignore(`an issue ${event.kind} event asks for no work`);
  if (!ISSUE_ACTIONS.has(event.action))
    return ignore(`an issue ${event.action} event asks for no work`);
  // The issue's own author and labels are read from the forge, not from the delivery.
  return { type: 'issue', thread };
}
