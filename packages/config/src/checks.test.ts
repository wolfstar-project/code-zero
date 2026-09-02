import { describe, expect, it } from 'vitest';

import {
  assertExecutableCommand,
  discoverChecks,
  detectPackageManager,
  resolveChecks,
} from './checks.js';

const packageJson = JSON.stringify({
  scripts: {
    build: 'tsdown',
    lint: 'oxlint src',
    test: 'vitest run',
    typecheck: 'tsc --noEmit',
    postinstall: 'node setup.mjs',
  },
});

describe('detectPackageManager', () => {
  it('prefers the packageManager field over a compatible lockfile', () => {
    expect(
      detectPackageManager({
        packageJson: JSON.stringify({ packageManager: 'aube@1.41.0' }),
        lockfiles: ['pnpm-lock.yaml'],
      }),
    ).toBe('aube');
  });

  it('falls back through supported lockfiles and then npm', () => {
    expect(detectPackageManager({ packageJson: null, lockfiles: ['aube-lock.yaml'] })).toBe('aube');
    expect(detectPackageManager({ packageJson: null, lockfiles: ['pnpm-workspace.yaml'] })).toBe(
      'pnpm',
    );
    expect(detectPackageManager({ packageJson: null, lockfiles: ['deno.lock'] })).toBe('deno');
    expect(detectPackageManager({ packageJson: null, lockfiles: [] })).toBe('npm');
  });
});

describe('discoverChecks', () => {
  it('returns the four native checks in lifecycle order', () => {
    expect(discoverChecks({ packageJson, lockfiles: ['pnpm-lock.yaml'] })).toEqual([
      'pnpm run lint',
      'pnpm run typecheck',
      'pnpm run test',
      'pnpm run build',
    ]);
  });

  it('only returns checks the repository actually declares', () => {
    const partial = JSON.stringify({ scripts: { test: 'vitest run' } });
    expect(discoverChecks({ packageJson: partial, lockfiles: ['package-lock.json'] })).toEqual([
      'npm run test',
    ]);
  });

  it('accepts an alternative script name for a kind', () => {
    const alternative = JSON.stringify({ scripts: { 'type-check': 'tsc --noEmit' } });
    expect(discoverChecks({ packageJson: alternative, lockfiles: [] })).toEqual([
      'npm run type-check',
    ]);
  });

  it('uses the package manager native run command', () => {
    const denoPackage = JSON.stringify({
      packageManager: 'deno@2.4.0',
      scripts: { test: 'deno test' },
    });
    expect(discoverChecks({ packageJson: denoPackage, lockfiles: [] })).toEqual(['deno task test']);
  });

  it('recognizes the workspace package manager declared by Code Zero', () => {
    const aubePackage = JSON.stringify({
      packageManager: 'aube@1.41.0',
      scripts: { lint: 'aube run format:check && aube run lint' },
    });
    expect(discoverChecks({ packageJson: aubePackage, lockfiles: ['pnpm-lock.yaml'] })).toEqual([
      'aube run lint',
    ]);
  });

  it('discovers nothing rather than guessing for a checkout without scripts', () => {
    expect(discoverChecks({ packageJson: null, lockfiles: ['pnpm-lock.yaml'] })).toEqual([]);
    expect(discoverChecks({ packageJson: '{ not json', lockfiles: [] })).toEqual([]);
    expect(discoverChecks({ packageJson: '{"scripts":{"test":"  "}}', lockfiles: [] })).toEqual([]);
  });
});

describe('resolveChecks', () => {
  it('prefers explicit configuration over discovery', () => {
    expect(resolveChecks(['make verify'], { packageJson, lockfiles: ['pnpm-lock.yaml'] })).toEqual([
      'make verify',
    ]);
  });

  it('falls back to discovery when nothing is configured', () => {
    expect(resolveChecks([], { packageJson, lockfiles: ['pnpm-lock.yaml'] })).toHaveLength(4);
  });
});

describe('assertExecutableCommand', () => {
  it('accepts a plain command with arguments and glob patterns', () => {
    expect(() => assertExecutableCommand('oxlint src/**/*.ts --deny-warnings')).not.toThrow();
  });

  it('rejects only empty commands and defers shell syntax to the runner', () => {
    // Shell semantics are owned by packages/runner, where ViteHub Shell analyzes every command
    // immediately before execution; configuration only enforces that a command exists at all.
    for (const command of [
      'pnpm test && pnpm build',
      'pnpm test; rm -rf .',
      'pnpm test | tee log',
      'pnpm test > out.txt',
      'echo $(whoami)',
      'echo `whoami`',
    ])
      expect(() => assertExecutableCommand(command)).not.toThrow();
    expect(() => assertExecutableCommand('   ')).toThrow('must not be empty');
  });
});
