/**
 * Public, non-secret site metadata and off-site destinations.
 *
 * Plain module-scope constants rather than `app.config.ts` + `useAppConfig()`: nothing here is
 * reactive, per-request, or environment-dependent, and the shared module registers this directory
 * with `addImportsDir`, so call sites get `site`/`links` auto-imported exactly like
 * `siteNavigation` and `mainContentId`. That also means the `unit` Vitest project (plain Node, no
 * Nuxt boot) can import this file directly.
 *
 * Anything that *does* need an environment override belongs in `nuxt.config.ts` instead — see the
 * two site URLs there.
 */
export const site = {
  name: 'Code Zero',
} as const;

/** Off-site destinations rendered in the header, footer, and calls to action. */
export const links = {
  repository: 'https://github.com/wolfstar-project/code-zero',
  issues: 'https://github.com/wolfstar-project/code-zero/issues',
  security: 'https://github.com/wolfstar-project/code-zero/blob/main/SECURITY.md',
  architecture: 'https://github.com/wolfstar-project/code-zero/blob/main/docs/architecture.md',
  docs: 'https://github.com/wolfstar-project/code-zero#readme',
  contactEmail: 'hello@code-zero.dev',
} as const;
