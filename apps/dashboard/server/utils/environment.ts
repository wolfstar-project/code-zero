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
