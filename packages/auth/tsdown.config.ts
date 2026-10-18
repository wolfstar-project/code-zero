import { definePackageConfig } from '../../scripts/tsdown.config.ts';

/**
 * `./config` and `./access` are separate entry points on purpose: they hold only policy (the
 * feature flags and capabilities, and the organization roles), so the dashboard can read them
 * without pulling `@code-zero/database` and the rest of the server instance into a browser bundle.
 */
export default definePackageConfig({
  entry: ['src/index.ts', 'src/access.ts', 'src/config.ts'],
  attw: {
    entrypoints: ['.', './access', './config'],
    enabled: true,
    level: 'error',
    profile: 'esm-only',
  },
});
