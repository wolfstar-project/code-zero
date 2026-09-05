import { githubTokenFromEnvironment, runTask } from '@code-zero/api';
import { GitHubPullRequests } from '@code-zero/source-control';

/**
 * Finds work on its own, so a self-hosted deployment does not need a public webhook URL.
 *
 * Off unless `CODE_ZERO_POLL_REPOSITORIES` names something. It runs an interval in this process,
 * so it belongs to a deployment that stays up: a serverless target freezes between requests and
 * would poll only by accident. Nothing else changes when it is off — the webhook route remains the
 * push-based path, and this is the pull-based one, sharing the same durable delivery claims so the
 * two cannot review the same commit twice.
 *
 * The mode is `observe` unless an operator asks for `suggest`. Work nobody requested must not be
 * able to write to a checkout, and neither mode can.
 *
 * The watched checkout has to be current: a review reads the diff between the pull request's base
 * and head commits, so a checkout that has not fetched them fails the run rather than reviewing
 * the wrong thing. Keeping it fetched is the operator's job, the same as it already is for the
 * webhook route.
 */
export default defineNitroPlugin((nitroApp) => {
  const repositories = watchedRepositoriesFromEnvironment(process.env);
  if (repositories.length === 0) return;

  const token = githubTokenFromEnvironment();
  if (!token) {
    console.warn('[poll] CODE_ZERO_POLL_REPOSITORIES is set but GITHUB_TOKEN is not; not polling');
    return;
  }

  const pulls = new GitHubPullRequests({ token });
  const intervalMs = pollIntervalFromEnvironment(process.env) * 1_000;
  const mode = pollModeFromEnvironment(process.env);
  let running = false;

  async function pass(): Promise<void> {
    // A pass that overruns its interval must not start a second one beside itself: the claims
    // would still keep the work unique, but the provider would be asked twice for nothing.
    if (running) return;
    running = true;
    try {
      await pollOnce({
        repositories,
        source: pulls,
        claims: deliveryClaimStore,
        start: (request) =>
          runTask(
            {
              repository: request.repository,
              mode,
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
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void pass(), intervalMs);
  // Never hold the process open on its own account: a deployment shutting down should not wait out
  // an interval that has nothing to do.
  timer.unref();
  nitroApp.hooks.hook('close', () => {
    clearInterval(timer);
  });

  console.info(
    `[poll] watching ${String(repositories.length)} repositories every ${String(intervalMs / 1_000)}s in ${mode} mode`,
  );
  void pass();
});
