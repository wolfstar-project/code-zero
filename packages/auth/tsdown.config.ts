import { definePackageConfig } from '../../scripts/tsdown.config.ts';

/**
 * `./config` is a second entry point on purpose: it holds only policy, so the dashboard can read
 * the feature flags without pulling `@code-zero/database` and the rest of the server instance
 * into a browser bundle.
 */
export default definePackageConfig({
  entry: ['src/index.ts', 'src/config.ts'],
  attw: {
    entrypoints: ['.', './config'],
    enabled: true,
    level: 'error',
    profile: 'node16',
  },
});
