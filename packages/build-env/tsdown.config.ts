import { definePackageConfig } from '../../scripts/tsdown.config.ts';

// ESM only, unlike the runtime packages that dual-publish. Both consumers are Nuxt builds — the
// module is loaded by `@nuxt/kit` and the run-time half is compiled into a Nitro server bundle,
// neither of which is ever `require`d, and a CJS build of a `export default` Nuxt module is
// exactly the interop hazard `attw` reports as a false default export.
//
// `src/nuxt.ts` is a second entry rather than a re-export from `src/index.ts`: it pulls in
// `@nuxt/kit`, which only exists inside a Nuxt build. Keeping it behind its own subpath means the
// run-time half (`.`) stays importable from a plain serverless bundle.
export default definePackageConfig({
  entry: ['src/index.ts', 'src/nuxt.ts'],
  format: ['esm'],
  attw: {
    entrypoints: ['.', './nuxt'],
    enabled: true,
    level: 'error',
    profile: 'esm-only',
  },
});
