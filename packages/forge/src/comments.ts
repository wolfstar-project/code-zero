import {
  redactSecrets,
  renderEvidenceMarkdown,
  secretValuesFromEnvironment,
  truncateHead,
  type EvidenceBundle,
} from '@code-zero/shared';
import type { ForgeProvider, ThreadRef } from 'forges';

import type { ChangeRequestRef } from './contracts.js';
import { guarded } from './errors.js';
import { prepareIssueValidationComment } from './issue-gate.js';
import { changeRequestThread, issueThread, type IssueTarget } from './refs.js';
import { providerFor, providerSecrets, type ForgeRegistry } from './registry.js';

export type CommentPublication =
  | {
      status: 'created' | 'updated';
      url?: string;
      /** Present when the forge could not edit an earlier comment and a new one was added. */
      degraded?: string;
    }
  | { status: 'skipped' | 'unsupported'; reason: string };

/**
 * Keys `threads.upsertComment()` writes into each body as a hidden marker, so the next run edits
 * its own comment instead of adding another, and nothing else's.
 */
export const commentKeys = {
  progress: 'code-zero:progress',
  evidence: 'code-zero:evidence',
  status: 'code-zero:status',
  issueValidation: 'code-zero:issue-validation',
} as const;

// Forges that declare no limit still reject very long bodies; this stays under every one known.
const DEFAULT_COMMENT_LIMIT = 30_000;
// Room for the hidden marker `upsertComment` appends.
const MARKER_ALLOWANCE = 200;

/** The longest body this provider's comments accept, marker included. */
function commentLimit(provider: ForgeProvider): number {
  return (provider.capabilities.limits?.commentLength ?? DEFAULT_COMMENT_LIMIT) - MARKER_ALLOWANCE;
}

/**
 * Post or edit the comment `key` identifies on a thread.
 *
 * The body is redacted against the connection's credentials and the environment, bounded to the
 * forge's limit, and rewritten into the forge's Markdown dialect. Where the forge cannot edit
 * comments a new one is added and the publication says so; where it cannot comment at all nothing
 * is sent and the reason is returned.
 */
export async function postKeyedComment(
  provider: ForgeProvider,
  thread: ThreadRef,
  key: string,
  body: string,
): Promise<CommentPublication> {
  const secrets = providerSecrets(provider);
  const clean = redactSecrets(body, [...secrets, ...secretValuesFromEnvironment()]);
  const text = truncateHead(provider.normaliseMarkdown(clean), commentLimit(provider));
  const forge = provider.forge;
  if (provider.can('threads.upsertComment', thread.kind)) {
    const result = await guarded(forge, secrets, 'comment', () =>
      provider.threads.upsertComment(thread, { key, body: text }),
    );
    return {
      status: result.created ? 'created' : 'updated',
      ...(result.comment.url === undefined ? {} : { url: result.comment.url }),
    };
  }
  if (provider.can('threads.comment', thread.kind)) {
    const comment = await guarded(forge, secrets, 'comment', () =>
      provider.threads.comment(thread, text),
    );
    return {
      status: 'created',
      ...(comment.url === undefined ? {} : { url: comment.url }),
      degraded: `${forge} cannot edit an earlier comment here, so a new one was added`,
    };
  }
  return { status: 'unsupported', reason: `${forge} cannot comment on this ${thread.kind}` };
}

/** Show a long run's progress on its change request, editing the same comment each time. */
export async function upsertProgressComment(
  registry: ForgeRegistry,
  target: ChangeRequestRef,
  body: string,
): Promise<CommentPublication> {
  const provider = providerFor(registry, target);
  return postKeyedComment(provider, changeRequestThread(target), commentKeys.progress, body);
}

/**
 * Publish a run's rendered evidence on its change request.
 *
 * Commit statuses carry a short description and no report, so the evidence travels as a comment;
 * a later run on the same change request replaces it rather than stacking another.
 */
export async function publishEvidenceComment(
  registry: ForgeRegistry,
  target: ChangeRequestRef,
  bundle: EvidenceBundle,
): Promise<CommentPublication> {
  const provider = providerFor(registry, target);
  const secrets = [...providerSecrets(provider), ...secretValuesFromEnvironment()];
  const body = renderEvidenceMarkdown(bundle, { maxLength: commentLimit(provider), secrets });
  return postKeyedComment(provider, changeRequestThread(target), commentKeys.evidence, body);
}

/**
 * Report an issue run's validation verdict on its issue.
 *
 * Report-only: this can add or edit Code Zero's own comment and nothing else, so it has no path to
 * label, edit, or close the issue. A run that never reached a verdict posts nothing.
 */
export async function publishIssueValidationComment(
  registry: ForgeRegistry,
  target: IssueTarget,
  bundle: EvidenceBundle,
): Promise<CommentPublication> {
  const comment = prepareIssueValidationComment(bundle);
  if (!comment.ready) return { status: 'skipped', reason: comment.reason };
  const provider = providerFor(registry, target);
  return postKeyedComment(provider, issueThread(target), commentKeys.issueValidation, comment.body);
}
