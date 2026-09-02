import { homedir } from 'node:os';
import { join } from 'node:path';

import { defaultConfig, type CodeZeroConfig } from '@code-zero/config';
import { describe, expect, it } from 'vitest';

import { claudeCodeProcessSpawner, environmentForModel } from './subscription-isolation.js';

function config(overrides: Partial<CodeZeroConfig['runner']> = {}): CodeZeroConfig {
  return { ...defaultConfig, runner: { ...defaultConfig.runner, ...overrides } };
}

/** Reads the value docker/podman would receive for a given `-e KEY=` or `--flag` pair, or `undefined`. */
function argAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

/** Every `-e KEY=VALUE` pair passed to the engine, decoded into a plain record. */
function envFlags(argv: readonly string[]): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '-e') continue;
    const pair = argv[i + 1] ?? '';
    const separator = pair.indexOf('=');
    entries[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return entries;
}

describe('environmentForModel', () => {
  it('passes the environment through unchanged under local isolation', () => {
    const environment = { CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true' };
    expect(environmentForModel(config({ isolation: 'local' }), environment)).toBe(environment);
  });

  it('passes the environment through unchanged when a container image is configured', () => {
    const environment = {
      CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true',
      CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE: 'code-zero/claude-code:latest',
    };
    expect(
      environmentForModel(config({ isolation: 'container', engine: 'docker' }), environment),
    ).toBe(environment);
  });

  it('refuses the transport when isolation is required but no CLI container image is set', () => {
    // This is the fix for the finding: without this, an operator who declared container isolation
    // would still get the claude-code CLI spawned unisolated on the host.
    const result = environmentForModel(config({ isolation: 'container', engine: 'docker' }), {
      CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true',
    });
    expect(result.CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER).toBe('false');
  });
});

describe('claudeCodeProcessSpawner', () => {
  it('spawns on the host directly under local isolation, matching prior behavior', () => {
    const spawn = claudeCodeProcessSpawner(config({ isolation: 'local' }), {});
    const child = spawn({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      env: {},
      signal: new AbortController().signal,
    });
    child.on('error', () => undefined);
    expect(child.spawnfile).toBe(process.execPath);
    child.kill();
  });

  it('throws rather than spawning unisolated when container isolation lacks an image', () => {
    expect(() => claudeCodeProcessSpawner(config({ isolation: 'container' }), {})).toThrow(
      'CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE',
    );
  });

  it('runs the container-installed CLI, not the host-resolved binary path the vendor SDK passed', () => {
    // The vendor SDK resolves `command` to an absolute path on the host (its own bundled binary,
    // or CODE_ZERO_CLAUDE_CODE_PATH) — a path that does not exist inside the container. Only the
    // in-container executable name may be used, which is why `command` here is deliberately
    // something that could never be a real container path.
    const spawn = claudeCodeProcessSpawner(config({ isolation: 'container', engine: 'podman' }), {
      CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE: 'code-zero/claude-code:latest',
    });
    const child = spawn({
      command: '/home/someone/.local/share/claude-agent-sdk/claude',
      args: ['--print'],
      env: {},
      signal: new AbortController().signal,
    });
    child.on('error', () => undefined);
    expect(child.spawnfile).toBe('podman');
    expect(child.spawnargs).toEqual(
      expect.arrayContaining(['code-zero/claude-code:latest', 'claude', '--print']),
    );
    // No repository checkout is ever mounted for this process, unlike ContainerRunner's repo
    // commands, and no --network flag ties it to the repository's own egress policy.
    expect(child.spawnargs).not.toEqual(
      expect.arrayContaining([expect.stringContaining('/workspace')]),
    );
    expect(child.spawnargs).not.toContain('--network');
    child.kill();
  });

  it('runs as the host UID:GID, so the CLI can pass its own file-ownership check on the mount', () => {
    // `--cap-drop ALL` means even a root user inside the container gets no bypass for a
    // credentials file it does not own; only matching the mount's real owner works.
    const spawn = claudeCodeProcessSpawner(config({ isolation: 'container', engine: 'docker' }), {
      CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE: 'code-zero/claude-code:latest',
    });
    const child = spawn({ command: 'x', args: [], env: {}, signal: new AbortController().signal });
    child.on('error', () => undefined);
    const expected =
      process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : undefined;
    expect(argAfter(child.spawnargs, '--user')).toBe(expected);
    child.kill();
  });

  it('mounts both host locations the CLI splits its session across, as container siblings', () => {
    // ~/.claude/ (credentials, settings) and ~/.claude.json (project/session record) are siblings
    // on the host, not nested — mounting the second inside the first's read-only bind fails at the
    // OCI runtime level, so both are mounted under one synthetic parent instead.
    const spawn = claudeCodeProcessSpawner(config({ isolation: 'container', engine: 'docker' }), {
      CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE: 'code-zero/claude-code:latest',
    });
    const child = spawn({ command: 'x', args: [], env: {}, signal: new AbortController().signal });
    child.on('error', () => undefined);
    const hostConfigDir = join(homedir(), '.claude');
    expect(child.spawnargs).toEqual(
      expect.arrayContaining(['--volume', `${hostConfigDir}:/code-zero/claude-home/.claude:ro`]),
    );
    expect(child.spawnargs).toEqual(
      expect.arrayContaining([
        '--volume',
        `${hostConfigDir}.json:/code-zero/claude-home/.claude.json:ro`,
      ]),
    );
    child.kill();
  });

  it('points $HOME at the synthetic parent, so the CLI finds both mounts by its own default rules', () => {
    const spawn = claudeCodeProcessSpawner(config({ isolation: 'container', engine: 'docker' }), {
      CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE: 'code-zero/claude-code:latest',
    });
    const child = spawn({
      command: 'x',
      args: [],
      env: { SOME_VENDOR_VAR: 'kept' },
      signal: new AbortController().signal,
    });
    child.on('error', () => undefined);
    const forwarded = envFlags(child.spawnargs);
    expect(forwarded.HOME).toBe('/code-zero/claude-home');
    expect(forwarded.CLAUDE_CONFIG_DIR).toBeUndefined();
    // The vendor SDK's own env still has to reach the process inside the container, not just the
    // isolation-specific additions — this is what -e flags exist for; see containerizedProcessArgv.
    expect(forwarded.SOME_VENDOR_VAR).toBe('kept');
    child.kill();
  });

  it('respects an operator-configured CLAUDE_CONFIG_DIR: one mount, matching override, no $HOME swap', () => {
    // An operator who already customized CLAUDE_CONFIG_DIR on the host is presumed to already keep
    // both files together under that one directory, so no second mount or synthetic parent is needed.
    const spawn = claudeCodeProcessSpawner(config({ isolation: 'container', engine: 'docker' }), {
      CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE: 'code-zero/claude-code:latest',
      CLAUDE_CONFIG_DIR: '/etc/code-zero/claude-config',
    });
    const child = spawn({ command: 'x', args: [], env: {}, signal: new AbortController().signal });
    child.on('error', () => undefined);
    expect(child.spawnargs).toEqual(
      expect.arrayContaining([
        '--volume',
        '/etc/code-zero/claude-config:/code-zero/claude-config:ro',
      ]),
    );
    expect(child.spawnargs.filter((arg) => arg === '--volume')).toHaveLength(1);
    const forwarded = envFlags(child.spawnargs);
    expect(forwarded.CLAUDE_CONFIG_DIR).toBe('/code-zero/claude-config');
    expect(forwarded.HOME).toBeUndefined();
    child.kill();
  });

  it('honors a container image whose CLI is installed somewhere other than the default name', () => {
    const spawn = claudeCodeProcessSpawner(config({ isolation: 'container', engine: 'docker' }), {
      CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE: 'code-zero/claude-code:latest',
      CODE_ZERO_CLAUDE_CODE_CONTAINER_EXECUTABLE: '/opt/claude/bin/claude',
    });
    const child = spawn({ command: 'x', args: [], env: {}, signal: new AbortController().signal });
    child.on('error', () => undefined);
    expect(child.spawnfile).toBe('docker');
    expect(child.spawnargs).toEqual(expect.arrayContaining(['/opt/claude/bin/claude']));
    child.kill();
  });

  it('forwards the repository runner resource limits to the CLI container', () => {
    const spawn = claudeCodeProcessSpawner(
      config({ isolation: 'container', engine: 'docker', cpus: '1', memory: '2g' }),
      { CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE: 'code-zero/claude-code:latest' },
    );
    const child = spawn({ command: 'x', args: [], env: {}, signal: new AbortController().signal });
    child.on('error', () => undefined);
    expect(child.spawnargs).toEqual(expect.arrayContaining(['--cpus', '1', '--memory', '2g']));
    child.kill();
  });
});
