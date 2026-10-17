import process from 'node:process';

import type { ConfigOptions } from '@nuxt/test-utils/playwright';
import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:5678';

export default defineConfig<ConfigOptions>({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['html'], ['junit', { outputFile: 'test-report.junit.xml' }]]
    : 'html',
  timeout: 120_000,
  webServer: {
    command: 'aube run start:playwright:webserver',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Runs `server/auth.config.ts` against an in-memory Better Auth adapter with signup enabled,
    // so `test/e2e/test-utils.ts` can sign up and sign in its own throwaway account through the
    // real `/api/auth/**` endpoints instead of a live database. `AUTH_DATABASE_URL` still has to
    // resolve for `authDatabaseOptionsFromEnvironment` to build, but this placeholder is never
    // dialed once the memory adapter overrides `database`.
    env: {
      AUTH_E2E_MEMORY: 'true',
      AUTH_ENABLE_SIGNUP: 'true',
      AUTH_DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
      // `nuxt preview` runs the production build, and `@onmax/nuxt-better-auth` only accepts the
      // unprefixed BETTER_AUTH_SECRET fallback in development — production requires this name.
      NUXT_BETTER_AUTH_SECRET: 'playwright-e2e-secret-not-used-in-production',
    },
  },
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
  use: {
    baseURL,
    trace: 'on-first-retry',
    nuxt: {
      rootDir: import.meta.dirname,
      host: baseURL,
    },
  },
  projects: [
    {
      name: 'chromium-headless-shell',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
