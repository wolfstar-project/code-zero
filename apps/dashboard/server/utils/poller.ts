import { reviewDeliveryKey, type DeliveryClaimStore } from '@code-zero/api';
import type { OpenPullRequest, RepositoryTarget } from '@code-zero/source-control';

/**
 * What one pass needs to know about a configured repository.
 *
 * Structural, so `@code-zero/database`'s `WatchedRepositoryRecord` satisfies it without this
 * module importing the store: the poller composes runs, it does not decide which repositories
 * exist. Two things have to be stated because neither can be derived — which repository on the
 * provider to ask about, and which checkout on this host a run may execute against.
 */
export interface WatchedRepository {
  owner: string;
  name: string;
  checkoutPath: string;
  /** The mode a run starts in. Neither value can write to the checkout. */
  mode: 'observe' | 'suggest';
}

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
  /**
   * The mode this repository is configured with, carried per repository rather than per pass:
   * one deployment can watch a repository it only observes beside one it may suggest on.
   */
  mode: 'observe' | 'suggest';
  pullRequest: { owner: string; repo: string; number: number; baseSha: string; headSha: string };
  /** Provenance for the task record, e.g. `poll:acme/app#412`. */
  source: string;
}

/**
 * The claim key for one review of one commit.
 *
 * Built with `@code-zero/api`'s `reviewDeliveryKey`, the same function the webhook route's
 * proactive-trigger path claims with: a commit a webhook delivery already claimed is one this pass
 * skips, and a commit this pass claims first is one a redelivered webhook observes rather than
 * reviews again. The head sha is part of the key rather than the pull request alone, which is what
 * makes a new push the thing that earns a new review: an unchanged pull request is claimed
 * already, and a force-push or a new commit is a key nobody has claimed.
 */
export function pollClaimKey(target: WatchedRepository, pull: OpenPullRequest): string {
  return reviewDeliveryKey({
    provider: 'github',
    owner: target.owner,
    repo: target.name,
    number: pull.number,
    headSha: pull.headSha,
  });
}

/**
 * One pass over every watched repository, starting a review for each pull request commit that has
 * not been reviewed yet.
 *
 * Every claimed review is started without waiting for it to finish before considering the next
 * pull request or repository: `options.start` hands the run to a scheduler that already bounds how
 * many run at once, so serializing ahead of it here would only make one long review delay the rest
 * of the pass discovering work behind it. Every started review is still awaited before this
 * function returns, so its outcome — recording the claim as complete, or releasing it for the next
 * pass to retry — is always settled by the time the caller acts on the count this returns.
 *
 * Returns how many reviews it started, which is what the caller logs; everything else about them
 * is on the task records the run itself writes.
 *
 * Drafts are skipped. A draft is the author saying the change is not ready to be read, and a
 * review that arrives anyway costs a model call to tell them something they already know.
 */
export async function pollOnce(options: PollOptions): Promise<number> {
  let started = 0;
  const dispatched: Promise<void>[] = [];

  for (const repository of options.repositories) {
    const label = `${repository.owner}/${repository.name}`;
    let open: OpenPullRequest[];
    try {
      open = await options.source.listOpenPullRequests({
        owner: repository.owner,
        repo: repository.name,
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

      started += 1;
      dispatched.push(
        options
          .start({
            repository: repository.checkoutPath,
            mode: repository.mode,
            pullRequest: {
              owner: repository.owner,
              repo: repository.name,
              number: pull.number,
              baseSha: pull.baseSha,
              headSha: pull.headSha,
            },
            source: `poll:${label}#${String(pull.number)}`,
          })
          .then(
            () => options.claims.complete(key, { started: true }),
            async (error: unknown) => {
              // The claim is released rather than completed, so the next pass retries this
              // commit. A failed start is a run that never happened; leaving the claim standing
              // would make one transient failure mean the commit is never reviewed at all.
              await options.claims.release(key).catch(() => undefined);
              options.onError?.(label, error);
            },
          ),
      );
    }
  }

  await Promise.all(dispatched);
  return started;
}
