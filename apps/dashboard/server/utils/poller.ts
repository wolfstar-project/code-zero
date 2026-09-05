import type { DeliveryClaimStore } from '@code-zero/api';
import type { OpenPullRequest, RepositoryTarget } from '@code-zero/source-control';

import type { WatchedRepository } from './environment.js';

/** The one thing the poller asks a provider for. Narrow so a test needs no HTTP adapter. */
export interface OpenPullRequestSource {
  listOpenPullRequests(target: RepositoryTarget): Promise<OpenPullRequest[]>;
}

export interface PollOptions {
  repositories: readonly WatchedRepository[];
  source: OpenPullRequestSource;
  /**
   * Where a started review is recorded so the next pass does not start it again.
   *
   * The same durable claim store the webhook route uses, and for the same reason: the claim
   * survives a restart and is shared by every instance, so a poller that comes back up does not
   * re-review every open pull request it had already looked at.
   */
  claims: DeliveryClaimStore;
  /** Starts one review. Injected, so the poller composes runs without being able to execute one. */
  start: (request: PollRequest) => Promise<unknown>;
  /** Reported per repository; one unreachable provider must not stop the rest of the pass. */
  onError?: (repository: string, error: unknown) => void;
}

export interface PollRequest {
  /** The local checkout the run executes against, always one an operator named. */
  repository: string;
  pullRequest: { owner: string; repo: string; number: number; baseSha: string; headSha: string };
  /** Provenance for the task record, e.g. `poll:acme/app#412`. */
  source: string;
}

/**
 * The claim key for one review of one commit.
 *
 * The head sha is part of the key rather than the pull request alone, which is what makes a new
 * push the thing that earns a new review: an unchanged pull request is claimed already, and a
 * force-push or a new commit is a key nobody has claimed.
 */
export function pollClaimKey(target: WatchedRepository, pull: OpenPullRequest): string {
  return `poll:${target.owner}/${target.repo}#${String(pull.number)}@${pull.headSha}`;
}

/**
 * One pass over every watched repository, starting a review for each pull request commit that has
 * not been reviewed yet.
 *
 * Returns how many reviews it started, which is what the caller logs; everything else about them
 * is on the task records the run itself writes.
 *
 * Drafts are skipped. A draft is the author saying the change is not ready to be read, and a
 * review that arrives anyway costs a model call to tell them something they already know.
 */
export async function pollOnce(options: PollOptions): Promise<number> {
  let started = 0;
  for (const repository of options.repositories) {
    const label = `${repository.owner}/${repository.repo}`;
    let open: OpenPullRequest[];
    try {
      open = await options.source.listOpenPullRequests({
        owner: repository.owner,
        repo: repository.repo,
      });
    } catch (error) {
      options.onError?.(label, error);
      continue;
    }

    for (const pull of open) {
      if (pull.draft) continue;
      const key = pollClaimKey(repository, pull);
      let claim;
      try {
        claim = await options.claims.claim(key);
      } catch (error) {
        options.onError?.(label, error);
        continue;
      }
      if (!claim.claimed) continue;

      try {
        await options.start({
          repository: repository.checkoutPath,
          pullRequest: {
            owner: repository.owner,
            repo: repository.repo,
            number: pull.number,
            baseSha: pull.baseSha,
            headSha: pull.headSha,
          },
          source: `poll:${label}#${String(pull.number)}`,
        });
        started += 1;
        await options.claims.complete(key, { started: true });
      } catch (error) {
        // The claim is released rather than completed, so the next pass retries this commit. A
        // failed start is a run that never happened; leaving the claim standing would make one
        // transient failure mean the commit is never reviewed at all.
        await options.claims.release(key).catch(() => undefined);
        options.onError?.(label, error);
      }
    }
  }
  return started;
}
