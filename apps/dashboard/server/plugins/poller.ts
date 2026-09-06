import { githubTokenFromEnvironment, runTask } from '@code-zero/api';
import { GitHubPullRequests } from '@code-zero/source-control';

/**
 * Finds work on its own, so a self-hosted deployment does not need a public webhook URL.
 *
 * Which repositories it watches is read from the store on every pass, not once at boot: the list
 * is a table an operator edits from the dashboard, so turning polling on for a repository has to
 * take effect without a restart. A pass over an empty list asks the provider nothing, which is
 * what makes it safe to always schedule the next one instead of deciding at boot whether to.
 *
 * It runs a timer in this process, so it belongs to a deployment that stays up: a serverless
 * target freezes between requests and would poll only by accident. Nothing else changes when
 * nothing is watched — the webhook route remains the push-based path, and this is the pull-based
 * one, sharing the same durable delivery claims so the two cannot review the same commit twice.
 *
 * Each pass schedules the next one when it finishes, rather than running on a fixed interval: a
 * pass that overruns cannot then have a second one start beside it, and the delay is re-read each
 * time, so `poll.interval_seconds` is answered by the same lazily-loaded configuration everything
 * else reads instead of a value captured before the plugin could await it.
 *
 * Each repository carries its own mode, and neither mode it may carry can write to a checkout:
 * work nobody requested must not be able to.
 *
 * The watched checkout has to be current: a review reads the diff between the pull request's base
 * and head commits, so a checkout that has not fetched them fails the run rather than reviewing
 * the wrong thing. Keeping it fetched is the operator's job, the same as it already is for the
 * webhook route.
 */
export default defineNitroPlugin((nitroApp) => {
  const token = githubTokenFromEnvironment();
  if (!token) {
    console.warn('[poll] GITHUB_TOKEN is not configured; not polling');
    return;
  }

  const pulls = new GitHubPullRequests({ token });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function pass(): Promise<void> {
    const watched = await repositoryStore.watched();
    // Only a GitHub source exists in this process; a repository configured for another provider
    // would otherwise be queried through it under owner/repo coordinates that provider never
    // issued, and — because `pollClaimKey` keys on the provider it is told — could never converge
    // with the claim its own webhook takes for the same commit. Reported rather than silently
    // dropped, since it names an operator's misconfiguration.
    const repositories = watched.flatMap((repository) => {
      if (repository.provider !== 'github') {
        console.warn(
          `[poll] ${repository.owner}/${repository.name} is configured for '${repository.provider}', which this poller cannot query; skipping`,
        );
        return [];
      }
      return [{ ...repository, provider: 'github' as const }];
    });
    if (repositories.length === 0) return;
    await pollOnce({
      repositories,
      source: pulls,
      claims: deliveryClaimStore,
      start: (request) =>
        runTask(
          {
            repository: request.repository,
            mode: request.mode,
            trigger: 'proactive',
            source: request.source,
            pullRequest: request.pullRequest,
          },
          { store: taskStore },
        ),
      onError: (repository, error) => {
        console.error(`[poll] ${repository} failed`, error);
      },
    });
  }

  async function loop(): Promise<void> {
    try {
      await pass();
    } catch (error) {
      // A pass that cannot even read the store must not take the timer down with it: the database
      // being briefly unreachable is a reason to try again, not to stop polling.
      console.error('[poll] pass failed', error);
    }
    if (stopped) return;
    const { poll } = await deploymentConfig();
    timer = setTimeout(() => void loop(), poll.intervalSeconds * 1_000);
    // Never hold the process open on its own account: a deployment shutting down should not wait
    // out an interval that has nothing to do.
    timer.unref();
  }

  nitroApp.hooks.hook('close', () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  });

  void loop();
});
