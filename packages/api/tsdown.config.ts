import { definePackageConfig } from '../../scripts/tsdown.config.ts';

/**
 * `./types` is a second entry point on purpose: it carries the wire shapes the dashboard renders,
 * so presentation can type its reads without pulling the agent runtime, Better Auth, or the
 * scheduler into its bundle.
 */
export default definePackageConfig({
  entry: ['src/index.ts', 'src/types.ts'],
  attw: {
    entrypoints: ['.', './types'],
    enabled: true,
    level: 'error',
    profile: 'esm-only',
  },
});
