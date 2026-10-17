import { describe, expect, it } from 'vitest';

import {
  defaultViteHubPreset,
  viteHubPresetFromEnvironment,
  viteHubVercelEntryAlias,
  viteHubVercelEntryName,
} from '../../config/env.js';

// Hoisted so the linter's no-regex-in-call rule holds and each pattern is compiled once.
const unsupportedNitroPreset = /Unsupported NITRO_PRESET value/u;
const unsupportedViteHubHosting = /Unsupported VITEHUB_HOSTING value/u;

describe('viteHubPresetFromEnvironment', () => {
  it('builds the self-hosted bundle when no deployment target is configured', () => {
    expect(viteHubPresetFromEnvironment({})).toBe(defaultViteHubPreset);
    expect(viteHubPresetFromEnvironment({ VITEHUB_HOSTING: '', NITRO_PRESET: '  ' })).toBe('node');
  });

  it('reads ViteHub plan names from its own hosting variable', () => {
    expect(viteHubPresetFromEnvironment({ VITEHUB_HOSTING: 'vercel' })).toBe('vercel');
    expect(viteHubPresetFromEnvironment({ VITEHUB_HOSTING: ' Cloudflare ' })).toBe('cloudflare');
    expect(viteHubPresetFromEnvironment({ VITEHUB_HOSTING: 'node' })).toBe('node');
  });

  it('reads the Nitro preset each plan pins from the Nitro variable', () => {
    expect(viteHubPresetFromEnvironment({ NITRO_PRESET: 'vercel' })).toBe('vercel');
    expect(viteHubPresetFromEnvironment({ NITRO_PRESET: 'node-server' })).toBe('node');
    expect(viteHubPresetFromEnvironment({ NITRO_PRESET: 'cloudflare_module' })).toBe('cloudflare');
    expect(viteHubPresetFromEnvironment({ NITRO_PRESET: ' Deno-Deploy ' })).toBe('deno');
    expect(viteHubPresetFromEnvironment({ NITRO_PRESET: 'netlify' })).toBe('netlify');
  });

  it('prefers the ViteHub hosting variable over the Nitro one', () => {
    expect(
      viteHubPresetFromEnvironment({ VITEHUB_HOSTING: 'vercel', NITRO_PRESET: 'node-server' }),
    ).toBe('vercel');
  });

  it('falls through a set-but-blank variable rather than letting it hide the next one', () => {
    expect(viteHubPresetFromEnvironment({ VITEHUB_HOSTING: '', NITRO_PRESET: 'vercel' })).toBe(
      'vercel',
    );
    expect(viteHubPresetFromEnvironment({ VITEHUB_HOSTING: '  ', NITRO_PRESET: 'vercel' })).toBe(
      'vercel',
    );
  });

  it('rejects a near miss instead of resolving it to the neighbouring target', () => {
    expect(() => viteHubPresetFromEnvironment({ NITRO_PRESET: 'node-typo' })).toThrow(
      unsupportedNitroPreset,
    );
    expect(() => viteHubPresetFromEnvironment({ VITEHUB_HOSTING: 'vercel-preview' })).toThrow(
      unsupportedViteHubHosting,
    );
  });

  it('rejects a Nitro preset ViteHub would refuse to build under', () => {
    // ViteHub pins `vercel` and `node-server`; anything else conflicts with its own plan check.
    expect(() => viteHubPresetFromEnvironment({ NITRO_PRESET: 'vercel-edge' })).toThrow(
      unsupportedNitroPreset,
    );
    expect(() => viteHubPresetFromEnvironment({ NITRO_PRESET: 'node' })).toThrow(
      unsupportedNitroPreset,
    );
  });

  it('rejects an inherited object property instead of treating it as a target', () => {
    expect(() => viteHubPresetFromEnvironment({ VITEHUB_HOSTING: 'constructor' })).toThrow(
      unsupportedViteHubHosting,
    );
    expect(() => viteHubPresetFromEnvironment({ NITRO_PRESET: '__proto__' })).toThrow(
      unsupportedNitroPreset,
    );
  });

  it('rejects a target it has no plan for', () => {
    expect(() => viteHubPresetFromEnvironment({ NITRO_PRESET: 'bun' })).toThrow(
      unsupportedNitroPreset,
    );
  });
});

describe('viteHubVercelEntryAlias', () => {
  it('names the entry ViteHub asserts on beside the function the preset emitted', () => {
    expect(viteHubVercelEntryAlias('/app/.vercel/output/functions/__fallback.func')).toBe(
      `/app/.vercel/output/functions/${viteHubVercelEntryName}`,
    );
  });
});
