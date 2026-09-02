import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  ContainerRunner,
  createRunner,
  LocalRunner,
  splitCommand,
  type BoundaryOptions,
  type ProcessOptions,
  type ProcessOutcome,
  type ProcessRunner,
} from './index.js';

/** A complete `diff --git` header line, as rendered for the whitespace-free test paths below. */
const COMPLETE_PATCH_HEADER = /^diff --git a\/\S+ b\/\S+$/;

/**
 * Reproduces the validate-then-swap race deterministically: validation passes against a real
 * directory, then the directory is replaced with a symlink before the filesystem operation runs.
 */
class SwappingRunner extends LocalRunner {
  constructor(
    root: string,
    private readonly outside: string,
    options: Partial<BoundaryOptions> = {},
  ) {
    super(root, options);
  }

  protected override async resolveInside(path: string): Promise<string> {
    const target = await super.resolveInside(path);
    await rm(join(this.root, 'staging'), { recursive: true, force: true });
    await symlink(this.outside, join(this.root, 'staging'));
    return target;
  }
}

/**
 * Reproduces the descriptor-rename race deterministically: every validation has already passed,
 * then the target inode is renamed over a file outside the checkout before the mutation commits.
 */
class TargetRenamingRunner extends LocalRunner {
  constructor(
    root: string,
    private readonly victim: string,
    options: Partial<BoundaryOptions> = {},
  ) {
    super(root, options);
  }

  protected override async replaceInside(
    directory: FileHandle,
    fallbackParent: string,
    targetName: string,
    content: string,
    original: string,
  ): Promise<void> {
    await rename(join(fallbackParent, targetName), this.victim);
    return super.replaceInside(directory, fallbackParent, targetName, content, original);
  }
}

/**
 * Simulates a platform without `/proc/self/fd` by anchoring the mutation to a dead descriptor:
 * closing the held handle first leaves it with `fd` -1, so the kernel cannot report where it
 * points, exactly as on systems that lack the facility.
 */
class ProclessRunner extends LocalRunner {
  protected override async replaceInside(
    directory: FileHandle,
    parent: string,
    targetName: string,
    content: string,
    original: string,
  ): Promise<void> {
    await directory.close();
    return super.replaceInside(directory, parent, targetName, content, original);
  }
}

interface Invocation {
  program: string;
  args: string[];
  options: ProcessOptions;
}

function recordingProcess(outcomes: Partial<Record<string, ProcessOutcome>> = {}): {
  runner: ProcessRunner;
  calls: Invocation[];
} {
  const calls: Invocation[] = [];
  const runner: ProcessRunner = async (program, args, options) => {
    calls.push({ program, args: [...args], options });
    return outcomes[program] ?? { exitCode: 0, stdout: '', stderr: '' };
  };
  return { runner, calls };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'code-zero-runner-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'user.ts'), 'export const user = null;\n', 'utf8');
});

describe('splitCommand', () => {
  it('splits quoted arguments without invoking a shell', () => {
    expect(splitCommand('pnpm test --filter "agent core"')).toEqual([
      'pnpm',
      'test',
      '--filter',
      'agent core',
    ]);
  });
});

describe('path boundary', () => {
  it('reads a file inside the checkout', async () => {
    const runner = new LocalRunner(root);
    await expect(runner.read('src/user.ts')).resolves.toContain('export const user');
    await expect(runner.exists('src/user.ts')).resolves.toBe(true);
    await expect(runner.exists('src/missing.ts')).resolves.toBe(false);
  });

  it('reads exact bytes, preserving content that is not valid UTF-8', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x80, 0x00]);
    await writeFile(join(root, 'src', 'image.png'), bytes);
    const runner = new LocalRunner(root);
    await expect(runner.readBytes('src/image.png')).resolves.toEqual(Buffer.from(bytes));
    // The string API would have replaced the invalid sequences; the byte API must not.
    expect(new TextEncoder().encode(await runner.read('src/image.png'))).not.toEqual(bytes);
  });

  it('rejects paths outside the repository', async () => {
    const runner = new LocalRunner(root);
    await expect(runner.read('../secret')).rejects.toThrow('Path escapes repository');
    await expect(runner.read('/etc/passwd')).rejects.toThrow('Path escapes repository');
    await expect(runner.readBytes('../secret')).rejects.toThrow('Path escapes repository');
  });

  it('refuses to read or write git metadata', async () => {
    const runner = new LocalRunner(root, { writable: true });
    await expect(runner.read('.git/config')).rejects.toThrow('Path escapes repository');
    await expect(runner.write('.git/hooks/pre-commit', 'payload')).rejects.toThrow(
      'Path escapes repository',
    );
  });

  it('refuses a write through a symlink that leaves the checkout', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'code-zero-outside-'));
    await writeFile(join(outside, 'target.txt'), 'original', 'utf8');
    await symlink(outside, join(root, 'linked'));
    const runner = new LocalRunner(root, { writable: true });
    await expect(runner.write('linked/target.txt', 'rewritten')).rejects.toThrow(
      'Path escapes repository',
    );
    await expect(runner.read('linked/target.txt')).rejects.toThrow('Path escapes repository');
  });

  it('refuses a read when a validated directory is swapped for a symlink before the open', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'code-zero-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'outside-secret', 'utf8');
    await mkdir(join(root, 'staging'));
    await writeFile(join(root, 'staging', 'secret.txt'), 'inside', 'utf8');
    const runner = new SwappingRunner(root, outside);
    await expect(runner.read('staging/secret.txt')).rejects.toThrow('Path escapes repository');
  });

  it('refuses a write when a validated directory is swapped for a symlink before the write lands', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'code-zero-outside-'));
    await mkdir(join(root, 'staging'));
    const runner = new SwappingRunner(root, outside, { writable: true });
    await expect(runner.write('staging/escape.txt', 'payload')).rejects.toThrow(
      'Path escapes repository',
    );
    // Nothing may land at the outside target, not even an empty file.
    await expect(access(join(outside, 'escape.txt'))).rejects.toThrow('ENOENT');
  });

  it('fails closed instead of renaming through a mutable path when descriptor anchoring is unavailable', async () => {
    const runner = new ProclessRunner(root, { writable: true });
    await expect(runner.write('src/user.ts', 'payload')).rejects.toThrow(
      'descriptor-anchored writes are not supported on this platform',
    );
    // The refused write must leave the target untouched.
    await expect(runner.read('src/user.ts')).resolves.toContain('export const user');
  });

  it('keeps a write contained when the validated target inode is renamed outside before it lands', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'code-zero-outside-'));
    const victim = join(outside, 'victim.txt');
    await writeFile(victim, 'external content', 'utf8');
    const runner = new TargetRenamingRunner(root, victim, { writable: true });
    await runner.write('src/user.ts', 'payload');
    // The mutation must land inside the checkout; the escaped inode receives nothing.
    await expect(readFile(victim, 'utf8')).resolves.not.toContain('payload');
    await expect(runner.read('src/user.ts')).resolves.toBe('payload');
  });

  it('allows a symlink that stays inside the checkout', async () => {
    await symlink(join(root, 'src'), join(root, 'alias'));
    const runner = new LocalRunner(root, { writable: true });
    await expect(runner.read('alias/user.ts')).resolves.toContain('export const user');
  });
});

describe('write policy', () => {
  it('refuses every write when the runner is read-only', async () => {
    const runner = new LocalRunner(root);
    await expect(runner.write('src/user.ts', 'changed')).rejects.toThrow(
      'this runner was created read-only',
    );
    await expect(new LocalRunner(root).read('src/user.ts')).resolves.toContain('null');
  });

  it('creates missing directories for a permitted write', async () => {
    const runner = new LocalRunner(root, { writable: true });
    await runner.write('src/nested/deep.ts', 'export const deep = 1;\n');
    await expect(runner.read('src/nested/deep.ts')).resolves.toContain('deep');
  });
});

describe('command execution', () => {
  it('passes an argv array and never a shell string', async () => {
    const { runner: process, calls } = recordingProcess();
    const runner = new LocalRunner(root, { process });
    await runner.check('pnpm run test --filter "agent core"', 5_000);
    expect(calls[0]?.program).toBe('pnpm');
    expect(calls[0]?.args).toEqual(['run', 'test', '--filter', 'agent core']);
    expect(calls[0]?.options.timeoutMs).toBe(5_000);
  });

  it('rejects a command that would need a shell', async () => {
    const runner = new LocalRunner(root);
    await expect(runner.check('pnpm test && rm -rf .', 1_000)).rejects.toThrow('Command rejected');
    await expect(runner.check('  ', 1_000)).rejects.toThrow('Command rejected');
  });

  it('reports a non-zero exit code as failure evidence', async () => {
    const { runner: process } = recordingProcess({
      pnpm: { exitCode: 2, stdout: 'out', stderr: 'boom' },
    });
    const result = await new LocalRunner(root, { process }).check('pnpm run test', 1_000);
    expect(result).toMatchObject({ exitCode: 2, stdout: 'out', stderr: 'boom' });
  });

  it('bounds and redacts captured output', async () => {
    const { runner: process } = recordingProcess({
      pnpm: {
        exitCode: 1,
        stdout: `${'x'.repeat(500)} ghp_0123456789abcdefghijklmnopqrstuvwxyz`,
        stderr: 'token=super-secret-value',
      },
    });
    const runner = new LocalRunner(root, { process, maxOutputBytes: 200 });
    const result = await runner.check('pnpm run test', 1_000);
    expect(result.stdout).not.toContain('ghp_0123456789');
    expect(result.stdout).toContain('[truncated');
    expect(result.stderr).toBe('token=[redacted]');
  });
});

describe('git inspection', () => {
  it('collects the file list and every pending local change through fixed arguments', async () => {
    const { runner: process, calls } = recordingProcess({
      git: { exitCode: 0, stdout: 'src/user.ts', stderr: '' },
    });
    const context = await new LocalRunner(root, { process }).context();
    expect(context).toContain('FILES');
    expect(context).toContain('CHANGED FILES');
    expect(context).toContain('DIFF');
    expect(calls.map((call) => call.args.join(' '))).toEqual([
      'ls-files',
      'diff --name-only -z --cached --',
      'diff --name-only -z --',
      'ls-files -z --others --exclude-standard',
      'diff --no-ext-diff HEAD --',
      'ls-files -z --others --exclude-standard',
      'diff --no-ext-diff --no-index -- /dev/null src/user.ts',
    ]);
  });

  it('includes staged and untracked files in a range-less local review', async () => {
    const outputs: Record<string, string> = {
      'diff --name-only -z --cached --': 'src/staged.ts\0src/both.ts\0',
      'diff --name-only -z --': 'src/edited.ts\0src/both.ts\0',
      'ls-files -z --others --exclude-standard': 'src/untracked.ts\0',
    };
    const process: ProcessRunner = async (program, args) => ({
      exitCode: 0,
      stdout: program === 'git' ? (outputs[args.join(' ')] ?? '') : '',
      stderr: '',
    });
    await expect(new LocalRunner(root, { process }).reviewFiles()).resolves.toEqual([
      'src/staged.ts',
      'src/both.ts',
      'src/edited.ts',
      'src/untracked.ts',
    ]);
  });

  it('feeds one consolidated final-state patch into the range-less review diff', async () => {
    const outputs: Record<string, string> = {
      'diff --no-ext-diff HEAD --': '+const final = true;',
      // The staged layer of a partially-staged file must never surface as a separate patch.
      'diff --no-ext-diff --cached --': '+const intermediate = true;',
    };
    const process: ProcessRunner = async (program, args) => ({
      exitCode: 0,
      stdout: program === 'git' ? (outputs[args.join(' ')] ?? '') : '',
      stderr: '',
    });
    const context = await new LocalRunner(root, { process }).context();
    expect(context).toContain('+const final = true;');
    expect(context).not.toContain('+const intermediate = true;');
  });

  it('includes a synthetic creation patch for each untracked file in the range-less review diff', async () => {
    const outputs: Record<string, string> = {
      'ls-files -z --others --exclude-standard': 'src/untracked.ts\0',
      'diff --no-ext-diff --no-index -- /dev/null src/untracked.ts': '+const untracked = true;',
    };
    const process: ProcessRunner = async (program, args) => {
      const argv = args.join(' ');
      const stdout = program === 'git' ? (outputs[argv] ?? '') : '';
      // `--no-index` reports "the paths differ" with exit code 1, like real git.
      const exitCode = argv.includes('--no-index') && stdout.length > 0 ? 1 : 0;
      return { exitCode, stdout, stderr: '' };
    };
    const context = await new LocalRunner(root, { process }).context();
    expect(context).toContain('src/untracked.ts');
    expect(context).toContain('+const untracked = true;');
  });

  it('keeps collecting untracked patches after one file exhausts the diff budget', async () => {
    // The diff budget is allocated per file in context(), so stopping the collection early
    // would silently drop a patch for a path reviewFiles() still publishes.
    const outputs: Record<string, string> = {
      'ls-files -z --others --exclude-standard': 'src/huge.ts\0src/late.ts\0',
      'diff --no-ext-diff --no-index -- /dev/null src/huge.ts': `diff --git a/src/huge.ts b/src/huge.ts\n+${'x'.repeat(150_000)}`,
      'diff --no-ext-diff --no-index -- /dev/null src/late.ts': '+const late = true;',
    };
    const process: ProcessRunner = async (program, args) => {
      const argv = args.join(' ');
      const stdout = program === 'git' ? (outputs[argv] ?? '') : '';
      // `--no-index` reports "the paths differ" with exit code 1, like real git.
      const exitCode = argv.includes('--no-index') && stdout.length > 0 ? 1 : 0;
      return { exitCode, stdout, stderr: '' };
    };
    const context = await new LocalRunner(root, { process }).context();
    expect(context).toContain('+const late = true;');
  });

  it('keeps a tracked patch in the review diff when an oversized untracked patch follows it', async () => {
    // A single tail-keeping truncation of the joined diff would evict the earlier tracked patch
    // while reviewFiles() still lists the tracked file; the per-file budget instead truncates
    // only the oversized patch, with an explicit marker.
    const outputs: Record<string, string> = {
      'diff --no-ext-diff HEAD --':
        'diff --git a/src/tracked.ts b/src/tracked.ts\n+const tracked = true;',
      'ls-files -z --others --exclude-standard': 'src/huge.ts\0',
      'diff --no-ext-diff --no-index -- /dev/null src/huge.ts': `diff --git a/src/huge.ts b/src/huge.ts\n+${'x'.repeat(150_000)}`,
    };
    const process: ProcessRunner = async (program, args) => {
      const argv = args.join(' ');
      const stdout = program === 'git' ? (outputs[argv] ?? '') : '';
      // `--no-index` reports "the paths differ" with exit code 1, like real git.
      const exitCode = argv.includes('--no-index') && stdout.length > 0 ? 1 : 0;
      return { exitCode, stdout, stderr: '' };
    };
    const context = await new LocalRunner(root, { process }).context();
    expect(context).toContain('+const tracked = true;');
    expect(context).toContain('[truncated');
  });

  it('keeps every rendered review patch attributable to its file under allocation pressure', async () => {
    // With enough long-path patches, a fair split of the diff budget is shorter than one
    // `diff --git` header line; a partial header could not be associated with any CHANGED FILES
    // entry, so every patch must render its complete header even when its body is omitted, and
    // each omission must be declared instead of surfacing as an anonymous fragment or a bare
    // count that leaves reviewers unable to tell which named files lack diff content.
    const patches = Array.from({ length: 2_000 }, (_, index) => {
      const path = `src/${'directory/'.repeat(12)}file-${String(index)}.ts`;
      return `diff --git a/${path} b/${path}\n+${'x'.repeat(400)}`;
    });
    const outputs: Record<string, string> = {
      'diff --no-ext-diff HEAD --': patches.join('\n'),
    };
    const process: ProcessRunner = async (program, args) => ({
      exitCode: 0,
      stdout: program === 'git' ? (outputs[args.join(' ')] ?? '') : '',
      stderr: '',
    });
    const context = await new LocalRunner(root, { process }).context();
    const diff = context.slice(context.indexOf('\nDIFF\n'));
    const headerLines = diff.split('\n').filter((line) => line.includes('diff --git'));
    expect(headerLines.length).toBe(patches.length);
    for (const line of headerLines) expect(line).toMatch(COMPLETE_PATCH_HEADER);
    expect(diff).toContain('[file patch omitted beyond the diff budget]');
  });

  it('marks an untracked file whose synthetic patch could not be produced instead of dropping it', async () => {
    // reviewFiles() publishes both paths as review targets, so a failed or empty `--no-index`
    // diff must surface an explicit marker rather than leaving a listed target without any
    // reviewable content in DIFF.
    const outputs: Record<string, string> = {
      'ls-files -z --others --exclude-standard': 'src/failed.ts\0src/empty.ts\0',
      'diff --no-ext-diff --no-index -- /dev/null src/empty.ts': '',
    };
    const process: ProcessRunner = async (program, args) => {
      const argv = args.join(' ');
      if (argv === 'diff --no-ext-diff --no-index -- /dev/null src/failed.ts')
        return { exitCode: 2, stdout: '', stderr: 'boom' };
      return { exitCode: 0, stdout: program === 'git' ? (outputs[argv] ?? '') : '', stderr: '' };
    };
    const context = await new LocalRunner(root, { process }).context();
    expect(context).toContain(
      'diff --git a/src/failed.ts b/src/failed.ts\n[untracked file patch unavailable: git diff --no-index failed]',
    );
    expect(context).toContain(
      'diff --git a/src/empty.ts b/src/empty.ts\n[untracked file patch unavailable: git diff --no-index rendered no patch]',
    );
  });

  it('keeps an untracked filename with special characters usable through NUL-delimited listings', async () => {
    // Newline-delimited git output would C-quote this name into a non-path display string.
    const weird = 'src/untracked\nfile.ts';
    const outputs: Record<string, string> = {
      'ls-files -z --others --exclude-standard': `${weird}\0`,
      [`diff --no-ext-diff --no-index -- /dev/null ${weird}`]: '+const weird = true;',
    };
    const process: ProcessRunner = async (program, args) => {
      const argv = args.join(' ');
      const stdout = program === 'git' ? (outputs[argv] ?? '') : '';
      // `--no-index` reports "the paths differ" with exit code 1, like real git.
      const exitCode = argv.includes('--no-index') && stdout.length > 0 ? 1 : 0;
      return { exitCode, stdout, stderr: '' };
    };
    const runner = new LocalRunner(root, { process });
    await expect(runner.reviewFiles()).resolves.toContain(weird);
    await expect(runner.context()).resolves.toContain('+const weird = true;');
  });

  it('consolidates the unborn-repository fallback into one final-state patch per file', async () => {
    const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const outputs: Record<string, string> = {
      'hash-object -t tree /dev/null': `${emptyTree}\n`,
      [`diff --no-ext-diff ${emptyTree} --`]: '+const final = true;',
      // The staged layer of a partially-staged file must never surface as a separate
      // overlapping patch that exposes its intermediate value.
      'diff --no-ext-diff --cached --': '+const staged = true;',
      'diff --no-ext-diff --': '+const unstaged = true;',
    };
    const process: ProcessRunner = async (program, args) => {
      const argv = args.join(' ');
      if (argv === 'diff --no-ext-diff HEAD --')
        return { exitCode: 128, stdout: '', stderr: 'unknown revision HEAD' };
      return { exitCode: 0, stdout: program === 'git' ? (outputs[argv] ?? '') : '', stderr: '' };
    };
    const context = await new LocalRunner(root, { process }).context();
    expect(context).toContain('+const final = true;');
    expect(context).not.toContain('+const staged = true;');
    expect(context).not.toContain('+const unstaged = true;');
  });

  it('collects a committed pull-request diff from the fixed merge-base range', async () => {
    const { runner: process, calls } = recordingProcess();
    const baseSha = 'b'.repeat(40);
    const headSha = 'a'.repeat(40);
    await new LocalRunner(root, { process }).context({ baseSha, headSha });
    const range = `${baseSha}...${headSha}`;
    expect(calls[1]?.args).toEqual(['diff', '--name-only', '-z', range, '--']);
    expect(calls[2]?.args).toEqual(['diff', '--no-ext-diff', range, '--']);
  });

  it('rejects untrusted commit references before invoking git', async () => {
    const { runner: process, calls } = recordingProcess();
    await expect(
      new LocalRunner(root, { process }).context({
        baseSha: 'main; rm -rf .',
        headSha: 'a'.repeat(40),
      }),
    ).rejects.toThrow('valid base and head commit SHAs');
    expect(calls).toEqual([]);
  });

  it('reports the changed-file set and resolves renames to the new path', async () => {
    const { runner: process } = recordingProcess({
      git: { exitCode: 0, stdout: ' M src/user.ts\nR  src/old.ts -> src/new.ts\n', stderr: '' },
    });
    await expect(new LocalRunner(root, { process }).changedFiles()).resolves.toEqual([
      'src/user.ts',
      'src/new.ts',
    ]);
  });

  it('degrades instead of failing when the checkout has no git history', async () => {
    const { runner: process } = recordingProcess({
      git: { exitCode: 128, stdout: '', stderr: 'not a git repository' },
    });
    await expect(new LocalRunner(root, { process }).context()).resolves.toContain('FILES');
  });
});

function remoteProcess(stdout: string, exitCode = 0): ProcessRunner {
  return async (program, args) =>
    program === 'git' && args.join(' ') === 'remote get-url origin'
      ? { exitCode, stdout, stderr: '' }
      : { exitCode: 0, stdout: '', stderr: '' };
}

describe('originRepository', () => {
  it('parses the owner and repository from an HTTPS origin', async () => {
    const runner = new LocalRunner(root, {
      process: remoteProcess('https://github.com/acme/app.git\n'),
    });
    await expect(runner.originRepository()).resolves.toEqual({ owner: 'acme', repo: 'app' });
  });

  it('parses an scp-style SSH origin', async () => {
    const runner = new LocalRunner(root, { process: remoteProcess('git@github.com:acme/app.git') });
    await expect(runner.originRepository()).resolves.toEqual({ owner: 'acme', repo: 'app' });
  });

  it('parses an ssh:// origin without the .git suffix', async () => {
    const runner = new LocalRunner(root, {
      process: remoteProcess('ssh://git@github.com/acme/app'),
    });
    await expect(runner.originRepository()).resolves.toEqual({ owner: 'acme', repo: 'app' });
  });

  it('reports no identity when the checkout has no origin remote', async () => {
    const runner = new LocalRunner(root, { process: remoteProcess('', 2) });
    await expect(runner.originRepository()).resolves.toBeNull();
  });

  it('reports no identity for an ambiguous multi-line answer', async () => {
    const runner = new LocalRunner(root, {
      process: remoteProcess('https://github.com/acme/app.git\nhttps://github.com/evil/app.git\n'),
    });
    await expect(runner.originRepository()).resolves.toBeNull();
  });

  it('reports no identity for a URL that does not name exactly owner/repo', async () => {
    for (const url of ['https://github.com/acme', 'https://github.com/a/b/c', '/srv/git/app'])
      await expect(
        new LocalRunner(root, { process: remoteProcess(url) }).originRepository(),
      ).resolves.toBeNull();
  });

  it('reports no identity for a remote hosted anywhere other than GitHub', async () => {
    for (const url of [
      'https://attacker.example/acme/app.git',
      'git@attacker.example:acme/app.git',
      'ssh://git@attacker.example/acme/app.git',
      'https://github.com.attacker.example/acme/app.git',
      'git@gitlab.com:acme/app.git',
    ])
      await expect(
        new LocalRunner(root, { process: remoteProcess(url) }).originRepository(),
      ).resolves.toBeNull();
  });

  it('accepts a GitHub host regardless of letter case', async () => {
    const runner = new LocalRunner(root, { process: remoteProcess('git@GitHub.com:acme/app.git') });
    await expect(runner.originRepository()).resolves.toEqual({ owner: 'acme', repo: 'app' });
  });
});

/** The value the engine would receive for `--network`. */
function networkArgument(runner: ContainerRunner): string | undefined {
  const args = runner.engineArguments();
  return args[args.indexOf('--network') + 1];
}

describe('ContainerRunner', () => {
  it('describes itself as an isolated boundary', () => {
    const runner = new ContainerRunner(root, {
      writable: true,
      network: 'none',
      engine: 'docker',
      image: 'node:22',
      workdir: '/workspace',
    });
    expect(runner.describe()).toEqual({
      kind: 'container',
      isolated: true,
      writable: true,
      network: 'none',
    });
  });

  it('runs the command in an ephemeral, capability-dropped container', async () => {
    const { runner: process, calls } = recordingProcess();
    const runner = new ContainerRunner(root, {
      writable: true,
      network: 'none',
      engine: 'docker',
      image: 'node:22',
      workdir: '/workspace',
      cpus: '2',
      memory: '4g',
      user: '1000:1000',
      process,
    });
    await runner.check('pnpm run test', 1_000);
    const args = calls[0]?.args ?? [];
    expect(calls[0]?.program).toBe('docker');
    expect(args.slice(0, 3)).toEqual(['run', '--rm', '--init']);
    expect(args).toContain('--cap-drop');
    expect(args).toContain('no-new-privileges');
    expect(args).toEqual(expect.arrayContaining(['--network', 'none']));
    expect(args).toEqual(expect.arrayContaining(['--volume', `${root}:/workspace`]));
    expect(args).toEqual(expect.arrayContaining(['--cpus', '2', '--memory', '4g']));
    expect(args).toEqual(expect.arrayContaining(['--user', '1000:1000']));
    expect(args.slice(-4)).toEqual(['node:22', 'pnpm', 'run', 'test']);
  });

  it('mounts the checkout read-only when the runner cannot write', () => {
    const runner = new ContainerRunner(root, {
      writable: false,
      network: 'none',
      engine: 'podman',
      image: 'node:22',
      workdir: '/workspace',
    });
    expect(runner.engineArguments()).toEqual(
      expect.arrayContaining(['--volume', `${root}:/workspace:ro`]),
    );
  });

  it('maps each egress policy to a concrete network', () => {
    const options = {
      writable: true,
      engine: 'docker' as const,
      image: 'node:22',
      workdir: '/workspace',
    };
    expect(networkArgument(new ContainerRunner(root, { ...options, network: 'none' }))).toBe(
      'none',
    );
    expect(networkArgument(new ContainerRunner(root, { ...options, network: 'full' }))).toBe(
      'bridge',
    );
    expect(networkArgument(new ContainerRunner(root, { ...options, network: 'restricted' }))).toBe(
      'code-zero',
    );
    expect(
      networkArgument(
        new ContainerRunner(root, { ...options, network: 'restricted', networkName: 'locked' }),
      ),
    ).toBe('locked');
  });
});

describe('createRunner', () => {
  it('builds a read-only local boundary by default', () => {
    expect(
      createRunner(root, { isolation: 'local', network: 'full', writable: false }).describe(),
    ).toEqual({ kind: 'local', isolated: false, writable: false, network: 'full' });
  });

  it('refuses container isolation without an image instead of downgrading', () => {
    expect(() =>
      createRunner(root, { isolation: 'container', network: 'none', writable: true }),
    ).toThrow('refusing to run without a sandbox');
  });

  it('builds an isolated boundary when an image is configured', () => {
    const runner = createRunner(root, {
      isolation: 'container',
      network: 'none',
      writable: true,
      container: { engine: 'docker', image: 'node:22', workdir: '/workspace' },
    });
    expect(runner.describe().isolated).toBe(true);
  });
});
