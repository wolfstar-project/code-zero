import { describe, expect, it } from 'vitest';

import { containerizedProcessArgv, spawnManagedProcess } from './process.js';

/** Read a spawned process's stdout to completion, resolving once it has fully exited. */
async function collect(child: ReturnType<typeof spawnManagedProcess>): Promise<{
  stdout: string;
  exitCode: number | null;
}> {
  const chunks: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  return { stdout: Buffer.concat(chunks).toString('utf8'), exitCode };
}

describe('spawnManagedProcess', () => {
  it('runs without a shell, so untrusted text in an argument can never become shell syntax', async () => {
    const child = spawnManagedProcess(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1])',
      '$(echo pwned)',
    ]);
    const { stdout, exitCode } = await collect(child);
    // A shell would have expanded this; argv-only execution passes it through literally.
    expect(stdout).toBe('$(echo pwned)');
    expect(exitCode).toBe(0);
  });

  it('hands back a live duplex handle a caller can write to and read from', async () => {
    const child = spawnManagedProcess(process.execPath, [
      '-e',
      'process.stdin.pipe(process.stdout)',
    ]);
    child.stdin?.write('echoed\n');
    child.stdin?.end();
    const { stdout, exitCode } = await collect(child);
    expect(stdout).toBe('echoed\n');
    expect(exitCode).toBe(0);
  });

  it('forwards cwd and env to the child, the same as the bounded command runner', async () => {
    const child = spawnManagedProcess(
      process.execPath,
      ['-e', 'process.stdout.write(process.cwd() + "|" + process.env.PROBE_VALUE)'],
      { cwd: process.cwd(), env: { ...process.env, PROBE_VALUE: 'set-by-caller' } },
    );
    const { stdout } = await collect(child);
    expect(stdout).toBe(`${process.cwd()}|set-by-caller`);
  });

  it('lets a caller-owned AbortSignal terminate a process with no timeout of its own', async () => {
    const controller = new AbortController();
    const child = spawnManagedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal: controller.signal,
    });
    // Node emits an AbortError on 'error' alongside 'exit' when a spawn signal fires; consuming it
    // here is the same obligation the vendor SDK's own SpawnedProcess.on('error', ...) slot exists
    // for, which every real caller of this primitive is expected to fill.
    child.on('error', () => undefined);
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    controller.abort();
    await exited;
    expect(child.killed).toBe(true);
  });

  it('runs inside a container when one is configured, instead of on the host', () => {
    // spawnManagedProcess itself does not expose what it spawned; containerizedProcessArgv is the
    // pure function it delegates to, and is asserted on directly below. This only proves the
    // container path is taken at all: docker as the resolved program, not the requested one. The
    // engine binary need not exist here — ENOENT is expected and harmless once handled.
    const child = spawnManagedProcess('claude', ['--version'], {
      container: { engine: 'docker', image: 'node:22' },
    });
    child.on('error', () => undefined);
    expect(child.spawnfile).toBe('docker');
    child.kill();
  });
});

describe('containerizedProcessArgv', () => {
  it('never mounts the repository checkout: a managed process is not a repository command', () => {
    const args = containerizedProcessArgv({ engine: 'docker', image: 'node:22' }, 'claude', [
      '--version',
    ]);
    expect(args).not.toContain('--volume');
  });

  it('carries the same hardening baseline as the repository container runner', () => {
    const args = containerizedProcessArgv({ engine: 'docker', image: 'node:22' }, 'claude', []);
    expect(args.slice(0, 4)).toEqual(['run', '-i', '--rm', '--init']);
    expect(args).toEqual(expect.arrayContaining(['--cap-drop', 'ALL']));
    expect(args).toEqual(expect.arrayContaining(['--security-opt', 'no-new-privileges']));
  });

  it('never passes --network: this process needs egress the repository policy must not gate', () => {
    const args = containerizedProcessArgv({ engine: 'docker', image: 'node:22' }, 'claude', []);
    expect(args).not.toContain('--network');
  });

  it('mounts explicit host state read-only, such as an existing CLI login session', () => {
    const args = containerizedProcessArgv(
      {
        engine: 'docker',
        image: 'node:22',
        mounts: [{ hostPath: '/home/op/.claude', containerPath: '/code-zero/claude-config' }],
      },
      'claude',
      [],
    );
    expect(args).toEqual(
      expect.arrayContaining(['--volume', '/home/op/.claude:/code-zero/claude-config:ro']),
    );
  });

  it('forwards resource limits and the run-as user when configured', () => {
    const args = containerizedProcessArgv(
      { engine: 'podman', image: 'node:22', cpus: '1', memory: '2g', user: '1000:1000' },
      'claude',
      [],
    );
    expect(args).toEqual(expect.arrayContaining(['--cpus', '1', '--memory', '2g']));
    expect(args).toEqual(expect.arrayContaining(['--user', '1000:1000']));
  });

  it('places the image before the program and its arguments, matching docker/podman run syntax', () => {
    const args = containerizedProcessArgv({ engine: 'docker', image: 'node:22' }, 'claude', [
      '--version',
      '--verbose',
    ]);
    expect(args.slice(-4)).toEqual(['node:22', 'claude', '--version', '--verbose']);
  });

  it('forwards env as -e flags: a container engine spawned on the host sets nothing inside the container on its own', () => {
    const args = containerizedProcessArgv({ engine: 'docker', image: 'node:22' }, 'claude', [], {
      HOME: '/code-zero/claude-home',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'code-zero/1.0',
    });
    expect(args).toEqual(expect.arrayContaining(['-e', 'HOME=/code-zero/claude-home']));
    expect(args).toEqual(
      expect.arrayContaining(['-e', 'CLAUDE_AGENT_SDK_CLIENT_APP=code-zero/1.0']),
    );
  });

  it('drops an env entry with no value rather than emitting a malformed -e flag', () => {
    const args = containerizedProcessArgv({ engine: 'docker', image: 'node:22' }, 'claude', [], {
      SET: 'value',
      UNSET: undefined,
    });
    expect(args).toEqual(expect.arrayContaining(['-e', 'SET=value']));
    expect(args).not.toContain('UNSET');
  });

  it('emits no -e flags at all when no env is supplied', () => {
    const args = containerizedProcessArgv({ engine: 'docker', image: 'node:22' }, 'claude', []);
    expect(args).not.toContain('-e');
  });
});
