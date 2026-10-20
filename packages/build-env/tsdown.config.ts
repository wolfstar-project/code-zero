import { definePackageConfig } from '../../scripts/tsdown.config.ts';

// `src/nuxt.ts` is a second entry rather than a re-export from `src/index.ts`: it pulls in
// `@nuxt/kit`, which only exists inside a Nuxt build. Keeping it behind its own subpath means the
// run-time half (`.`) stays importable from a plain serverless bundle.
export default definePackageConfig({
  entry: ['src/index.ts', 'src/nuxt.ts'],
  attw: {
    entrypoints: ['.', './nuxt'],
    enabled: true,
    level: 'error',
    profile: 'esm-only',
  },
});
