/**
 * Every environment variable this app's server reads, resolved in one module.
 *
 * Each resolver takes the environment record rather than reaching for `process.env` itself, so
 * routes stay testable without mutating the real process environment, and so the read stays lazy:
 * a deployment can set these at run time, unlike Nuxt's `runtimeConfig`, whose defaults are baked
 * at build time and would require renaming every variable to its `NUXT_`-prefixed form.
 */
export function dashboardUrlFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const configuredUrl = environment.NUXT_PUBLIC_SITE_URL?.trim();
  if (configuredUrl) return configuredUrl;
  return environment.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined;
}

/**
 * Without this secret the webhook route ingests nothing; signature verification cannot run.
 *
 * The value is read verbatim: GitHub signs each delivery with the exact bytes configured on the
 * hook, so trimming here would silently break verification for a secret that legitimately has
 * surrounding whitespace. Only an absent or empty variable counts as unconfigured.
 */
export function githubWebhookSecretFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return environment.GITHUB_WEBHOOK_SECRET || undefined;
}

/** The checkout every ingested delivery runs against, behind the runner boundary. */
export function checkoutPathFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return environment.CODE_ZERO_CHECKOUT_PATH?.trim() || undefined;
}

/**
 * The repositories the poller watches, as `owner/name=/path/to/checkout` entries.
 *
 * Two things have to be stated because neither can be derived: which repository on the provider to
 * ask about, and which checkout on this host a run may execute against. Pairing them here rather
 * than deriving the second from the first keeps the poller from ever pointing a run at a path an
 * operator did not name — the same rule `CODE_ZERO_CONTROL_PLANE_REPOSITORIES` states for the API.
 *
 * A malformed entry is dropped rather than raised: a typo in one repository must not stop the
 * server from starting, and the poller reports what it watches when it starts.
 */
export interface WatchedRepository {
  owner: string;
  repo: string;
  checkoutPath: string;
}

export function watchedRepositoriesFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): WatchedRepository[] {
  const configured = environment.CODE_ZERO_POLL_REPOSITORIES?.trim();
  if (!configured) return [];
  const watched: WatchedRepository[] = [];
  for (const entry of configured.split(',')) {
    const [slug, checkoutPath] = entry.split('=', 2).map((part) => part.trim());
    const [owner, repo] = (slug ?? '').split('/', 2).map((part) => part.trim());
    if (!owner || !repo || !checkoutPath) continue;
    watched.push({ owner, repo, checkoutPath });
  }
  return watched;
}

/** Seconds between polls. Below the floor a poll spends more rate limit than it earns. */
export function pollIntervalFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const configured = Number.parseInt(environment.CODE_ZERO_POLL_INTERVAL_SECONDS?.trim() ?? '', 10);
  if (!Number.isFinite(configured)) return 60;
  return Math.min(Math.max(configured, 15), 3_600);
}

/**
 * The execution mode the poller requests. `observe` unless an operator says otherwise, because
 * work nobody asked for should not be able to write to a checkout.
 */
export function pollModeFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): 'observe' | 'suggest' {
  return environment.CODE_ZERO_POLL_MODE?.trim() === 'suggest' ? 'suggest' : 'observe';
}
