import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import BuildEnvironment from '~~/modules/shared/components/BuildEnvironment.vue';

/**
 * Under test the module publishes its fixed metadata (`dev`, commit `0000…`), so every assertion
 * here is about what the component does with a build, not about the checkout it runs in.
 */
describe('BuildEnvironment', () => {
  it('names the deploy channel rather than a version outside a release', async () => {
    const wrapper = await mountSuspended(BuildEnvironment);

    expect(wrapper.text()).toContain('dev');
    expect(wrapper.text()).not.toContain('v0.0.0');
  });

  it('links the commit it is serving, so a bug report can be pinned to one build', async () => {
    const wrapper = await mountSuspended(BuildEnvironment);
    const commit = wrapper.get('a[href*="/commit/"]');

    expect(commit.text()).toBe('0000000');
    expect(commit.attributes('href')).toBe(
      'https://github.com/wolfstar-project/agent-zero/commit/0000000000000000000000000000000000000000',
    );
  });

  it('opens GitHub in a new tab without handing it a window reference', async () => {
    const wrapper = await mountSuspended(BuildEnvironment);
    const commit = wrapper.get('a[href*="/commit/"]');

    expect(commit.attributes('target')).toBe('_blank');
    expect(commit.attributes('rel')).toContain('noreferrer');
    expect(commit.attributes('aria-label')).toContain('0000000');
  });
});

describe('BuildEnvironment on a release', () => {
  /** A release, which a test run can never be: the module publishes `dev` under test. */
  const release = {
    version: '1.2.3',
    commit: '1234567890abcdef1234567890abcdef12345678',
    branch: 'main',
    env: 'release',
    time: 0,
    prNumber: null,
    previewUrl: null,
    productionUrl: 'https://agent-zero.dev',
  } as const;

  it('names the version and links its tag, which is the one channel that has one', async () => {
    const wrapper = await mountSuspended(BuildEnvironment, { props: { buildInfo: release } });
    const version = wrapper.get('a[href*="/releases/tag/"]');

    expect(version.text()).toBe('v1.2.3');
    expect(version.attributes('href')).toBe(
      'https://github.com/wolfstar-project/agent-zero/releases/tag/v1.2.3',
    );
  });

  it('hides the commit link for a build that resolved no commit', async () => {
    const wrapper = await mountSuspended(BuildEnvironment, {
      props: { buildInfo: { ...release, commit: null } },
    });

    expect(wrapper.find('a[href*="/commit/"]').exists()).toBe(false);
  });
});
