import {
  evidenceTitle,
  redactSecrets,
  secretValuesFromEnvironment,
  type EvidenceBundle,
} from '@code-zero/shared';
import type { CheckState } from 'forges';

import { commentKeys, postKeyedComment } from './comments.js';
import {
  runOutcome,
  type ChangeRequestRef,
  type RunOutcome,
  type StatusPublication,
} from './contracts.js';
import { guarded } from './errors.js';
import { changeRequestThread, repoRef } from './refs.js';
import { providerFor, providerSecrets, type ForgeRegistry } from './registry.js';

export interface PublishOutcomeOptions {
  /** Status or check name, so several Code Zero configurations can report side by side. */
  name?: string;
  /** Where a person reads the evidence, such as the task in the dashboard. */
  detailsUrl?: string;
}

// GitHub's commit-status description limit, the tightest of the forges Code Zero connects to.
const MAX_DESCRIPTION = 140;

/**
 * The check state each outcome asks for. `forges` has no action-required state, so it is reported
 * as a failure: a run waiting for a human must not let the change request quietly proceed.
 */
const REQUESTED: Record<RunOutcome, Exclude<CheckState, 'unknown' | 'pending'>> = {
  success: 'success',
  failure: 'failure',
  neutral: 'neutral',
  'action-required': 'failure',
};

/**
 * Report what a run means for its change request.
 *
 * `checks.report` writes a check run where the credential can (a GitHub App) and a commit status
 * otherwise, and `surface` says which. The state the forge recorded is compared with the one asked
 * for, so a forge that has no neutral state and records something else is reported as degraded
 * instead of silently passing for neutral. Without a status surface the outcome is posted as a comment, and the publication says
 * so. A failed verification is never reported as success, because `runOutcome` is the only input.
 */
export async function publishOutcome(
  registry: ForgeRegistry,
  target: ChangeRequestRef,
  bundle: EvidenceBundle,
  options: PublishOutcomeOptions = {},
): Promise<StatusPublication> {
  const provider = providerFor(registry, target);
  const secrets = providerSecrets(provider);
  const outcome = runOutcome(bundle);
  const requested = REQUESTED[outcome];
  const description = redactSecrets(evidenceTitle(bundle), [
    ...secrets,
    ...secretValuesFromEnvironment(),
  ]).slice(0, MAX_DESCRIPTION);
  const notes: string[] = [];
  if (outcome === 'action-required')
    notes.push('there is no action-required state, so it was reported as a failure');

  if (provider.can('checks.report')) {
    const check = await guarded(target.forge, secrets, 'status report', () =>
      provider.checks.report(repoRef(target), target.headSha, {
        name: options.name ?? 'Code Zero',
        state: requested,
        description,
        ...(options.detailsUrl === undefined ? {} : { url: options.detailsUrl }),
      }),
    );
    const surface = check.ref.type === 'check_run' ? 'check-run' : 'commit-status';
    if (check.state !== requested)
      notes.push(`${target.forge} recorded ${check.stateRaw} for a ${outcome} outcome`);
    return { outcome, surface, state: check.stateRaw, ...degradation(notes) };
  }

  const comment = await postKeyedComment(
    provider,
    changeRequestThread(target),
    commentKeys.status,
    `**Code Zero: ${outcome}.** ${description}`,
  );
  if (comment.status === 'skipped' || comment.status === 'unsupported')
    return {
      outcome,
      surface: 'none',
      state: 'unreported',
      degraded: `${target.forge} can report neither a status nor a comment: ${comment.reason}`,
    };
  notes.push(`${target.forge} cannot report a status here, so the outcome was posted as a comment`);
  return { outcome, surface: 'comment', state: outcome, ...degradation(notes) };
}

function degradation(notes: readonly string[]): { degraded?: string } {
  return notes.length === 0 ? {} : { degraded: notes.join('; ') };
}
