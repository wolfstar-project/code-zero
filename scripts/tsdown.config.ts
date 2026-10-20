import VersionInjector from '@redstardev/unplugin-version-injector/rolldown';
import { defineConfig, type UserConfig } from 'tsdown';

const baseConfig = {
  entry: ['src/index.ts'],
  platform: 'node',
  target: 'node24.2',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  minify: false,
  failOnWarn: true,
  checks: {
    // v0.0.2 transforms the version marker without returning a source map.
    // Keep source maps enabled while suppressing only Rolldown's plugin-map warning.
    sourcemapBroken: false,
  },
  treeshake: true,
  deps: {
    neverBundle: true,
  },
  plugins: [VersionInjector()],
} satisfies UserConfig;

const packageConfig = {
  ...baseConfig,
  // ESM only. Every consumer is a Node 24 process or a Vite/Nitro build, and `forges` (the
  // source-control boundary's client) publishes no CommonJS build, so a CJS output here would only
  // add an interop surface nothing loads.
  format: ['esm'],
  outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
  dts: {
    sourcemap: true,
  },
  attw: {
    entrypoints: ['.'],
    enabled: true,
    level: 'error',
    profile: 'esm-only',
  },
  publint: {
    enabled: true,
    level: 'error',
  },
} satisfies UserConfig;

const appConfig = {
  ...baseConfig,
  format: ['esm'],
  fixedExtension: false,
  dts: false,
} satisfies UserConfig;

export function definePackageConfig(overrides: UserConfig = {}) {
  return defineConfig({
    ...packageConfig,
    ...overrides,
  });
}

export function defineAppConfig(overrides: UserConfig = {}) {
  return defineConfig({
    ...appConfig,
    ...overrides,
  });
}
