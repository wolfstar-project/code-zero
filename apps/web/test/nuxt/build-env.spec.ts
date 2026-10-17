import { describe, expect, it } from 'vitest';

import { useBuildInfo } from '#imports';

/**
 * The dashboard's half of `packages/build-env`: that the module is registered, that it publishes
 * its metadata where `useBuildInfo()` reads it, and that a test run gets the fixed values rather
 * than whatever branch and commit the checkout happens to be on.
 *
 * The resolution itself is covered by the package's own suites; what cannot be covered there is
 * the wiring — the auto-import, and the runtime-config key it reads.
 */
describe('useBuildInfo', () => {
  it('publishes deterministic metadata under test, so no assertion depends on the checkout', () => {
    expect(useBuildInfo()).toStrictEqual({
      version: '0.0.0',
      commit: '0000000000000000000000000000000000000000',
      branch: 'test',
      env: 'dev',
      time: 0,
      prNumber: null,
      previewUrl: null,
      productionUrl: null,
    });
  });

  it('reads the same values the build published to the public runtime config', () => {
    expect(useBuildInfo()).toStrictEqual(useRuntimeConfig().public.buildInfo);
  });
});
