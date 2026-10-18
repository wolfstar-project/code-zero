import { fileURLToPath } from 'node:url';

import { defineVitestProject } from '@nuxt/test-utils/config';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * The same two-project split the dashboard uses:
 *
 * - `unit` runs pure logic (and the content/dictionary contract) in a plain Node environment with
 *   the Nuxt path aliases mapped manually, so no app build is needed.
 * - `nuxt` boots the real app runtime through `@nuxt/test-utils`, so component specs exercise the
 *   same i18n and auto-import wiring the site ships with. The DOM comes from happy-dom rather than
 *   a real browser: CI installs no browser binaries for the unit-test job.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '~': fileURLToPath(new URL('./app', import.meta.url)),
            '~~': rootDir,
          },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.{test,spec}.ts', '{app,config}/**/*.{test,spec}.ts'],
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          environment: 'nuxt',
          // `@nuxt/test-utils` boots the whole app in a `beforeAll` hook before the first spec in
          // each worker. On a cold cache or a loaded machine that boot alone outlasts Vitest's
          // default 10 s hook timeout, which fails the file before any assertion runs.
          hookTimeout: 60_000,
          include: ['test/nuxt/**/*.{test,spec}.ts'],
          environmentOptions: {
            nuxt: {
              rootDir,
              domEnvironment: 'happy-dom',
            },
          },
        },
      }),
    ],
  },
});
