import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

import { analyzeShellCommand } from '@vite-hub/shell';
import { anyOf, charIn, charNotIn, createRegExp, exactly, global, oneOrMore } from 'magic-regexp';

// Type-only: erased at compile time, so this does not create a runtime cycle with container.ts,
// which imports `commandArgv` from this module.
import type { ContainerEngine } from './container.js';

const execFileAsync = promisify(execFile);

/** Raised when a command could not be executed faithfully as an argv array. */
export class CommandRejectedError extends Error {
  constructor(command: string, reason: string) {
    super(`Command rejected (${reason}): ${command}`);
    this.name = 'CommandRejectedError';
  }
}

/** Raw result of one child process, before any policy is applied. */
export interface ProcessOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

/**
 * Starts a child process with explicit arguments.
 *
 * Injected so that every runner can be tested without touching a real process, a container engine,
 * or the network.
 */
export type ProcessRunner = (
  program: string,
  args: readonly string[],
  options: ProcessOptions,
) => Promise<ProcessOutcome>;

/**
 * The bounded-command half of the only place Code Zero spawns a process; {@link spawnManagedProcess}
 * is the other half, for a caller that needs a live process instead of one buffered result.
 *
 * There is no shell: the program and its arguments are passed as an argv array, so untrusted text
 * can never become shell syntax. Output is bounded and a timeout always applies.
 */
export const execFileProcessRunner: ProcessRunner = async (program, args, options) => {
  try {
    const { stdout, stderr } = await execFileAsync(program, [...args], {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: options.maxOutputBytes,
      shell: false,
      windowsHide: true,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return outcomeFromFailure(error);
  }
};

/** A host directory a containerized process needs to read, mounted read-only. */
export interface ManagedProcessMount {
  hostPath: string;
  containerPath: string;
}

/**
 * How to isolate a long-running process behind a container instead of running it on the host.
 *
 * Deliberately not {@link ContainerOptions} from `container.ts`: that shape mounts the repository
 * checkout and inherits the repository's own `permissions.network` policy, both wrong here. A
 * managed process is not a repository command — it needs no checkout access, and a process such as
 * a subscription model CLI needs outbound network access regardless of what the repository's
 * network policy says, since that policy exists to contain an *untrusted checkout's* commands, not
 * to block Code Zero's own necessary calls. So this takes only what isolating one process actually
 * requires: an engine, an image that has the program installed, and explicit read-only mounts for
 * whatever state (such as an existing CLI login session) the process must read from the host.
 */
export interface ManagedProcessContainerOptions {
  engine: ContainerEngine;
  image: string;
  mounts?: ManagedProcessMount[];
  cpus?: string;
  memory?: string;
  user?: string;
}

export interface ManagedSpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Runs the process inside a container instead of directly on the host when supplied. */
  container?: ManagedProcessContainerOptions;
}

/**
 * The streaming half of the only place Code Zero spawns a process: a live, long-running child a
 * caller talks to over `stdin`/`stdout` rather than a single buffered result.
 *
 * This exists for adapters that must hand a real process handle to code Code Zero does not
 * control — a CLI-backed model transport's vendor SDK, for one, which drives the child itself over
 * a duplex stream and cannot be satisfied by a request/response command. `execFileProcessRunner`
 * stays the right primitive for everything that only needs a command's finished output.
 *
 * There is no shell here either: the program and its arguments are passed as an argv array, so
 * untrusted text can never become shell syntax. Unlike `execFileProcessRunner`, this applies no
 * timeout or output limit of its own — a live process has no fixed end, so bounding its lifetime
 * and its output is the caller's responsibility once it holds the handle.
 */
export function spawnManagedProcess(
  program: string,
  args: readonly string[],
  options: ManagedSpawnOptions = {},
): ChildProcess {
  const [resolvedProgram, resolvedArgs] = options.container
    ? [
        options.container.engine,
        containerizedProcessArgv(options.container, program, args, options.env),
      ]
    : [program, [...args]];
  return spawn(resolvedProgram, resolvedArgs, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    // `options.env` belongs to the process this call ultimately runs — inside the container when
    // one is configured (forwarded as `-e` flags below, since a spawned engine CLI's own env sets
    // nothing inside the container it starts), on the host otherwise. The local `docker`/`podman`
    // client needs its own inherited environment (PATH, DOCKER_HOST) either way, so it is left
    // alone — omitting `env` here means Node inherits `process.env` for that local process.
    ...(options.container || options.env === undefined ? {} : { env: options.env }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Build the `docker`/`podman run` invocation that isolates one long-running process.
 *
 * Same hardening baseline as `ContainerRunner.engineArguments()` (`--init`, dropped capabilities,
 * no new privileges), `-i` so the vendor SDK's piped stdin actually reaches the process, and `--rm`
 * so a killed or crashed process leaves nothing behind. No `--network` flag: unlike a repository
 * command, this process is expected to reach the network, so the engine's normal default applies
 * rather than the repository's `permissions.network` policy.
 *
 * `env` becomes `-e KEY=VALUE` flags rather than an option on the `docker`/`podman` process itself:
 * a container engine's own env only configures the *client* (`DOCKER_HOST` and the like) and sets
 * nothing inside the container it starts, so a caller's environment — `$HOME`, in particular, for a
 * CLI whose config-file resolution depends on it — has to be threaded through explicitly like this
 * to actually reach the process running inside. Passed as literal argv elements (`spawn` never
 * invokes a shell), so no value here needs escaping regardless of what it contains.
 *
 * Exported directly, the same way `ContainerRunner.engineArguments()` is, so the invocation this
 * builds can be asserted on without spawning a real container.
 */
export function containerizedProcessArgv(
  container: ManagedProcessContainerOptions,
  program: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): string[] {
  const argv = [
    'run',
    '-i',
    '--rm',
    '--init',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
  ];
  for (const mount of container.mounts ?? [])
    argv.push('--volume', `${mount.hostPath}:${mount.containerPath}:ro`);
  if (container.user) argv.push('--user', container.user);
  if (container.cpus) argv.push('--cpus', container.cpus);
  if (container.memory) argv.push('--memory', container.memory);
  for (const [key, value] of Object.entries(env ?? {}))
    if (value !== undefined) argv.push('-e', `${key}=${value}`);
  argv.push(container.image, program, ...args);
  return argv;
}

function outcomeFromFailure(error: unknown): ProcessOutcome {
  const failure = isRecord(error) ? error : {};
  const stdout = typeof failure.stdout === 'string' ? failure.stdout : '';
  const stderr =
    typeof failure.stderr === 'string' && failure.stderr.length > 0
      ? failure.stderr
      : error instanceof Error
        ? error.message
        : String(error);
  const exitCode = typeof failure.code === 'number' ? failure.code : 1;
  return { exitCode: exitCode === 0 ? 1 : exitCode, stdout, stderr };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SHELL_OPERATORS = createRegExp(charIn(';&|<>`$(){}\n\r'));
const commandPart = anyOf(
  oneOrMore(charNotIn(' \t\n\r\f\v"\'')),
  exactly('"').and(charNotIn('"').times.any()).and('"'),
  exactly("'").and(charNotIn("'").times.any()).and("'"),
);
const COMMAND_PARTS = createRegExp(commandPart, [global]);

/**
 * Convert a repository-provided verification command into the argv that a runner may execute.
 *
 * This is the single command preflight path for every runner. ViteHub Shell parses the command and
 * rejects malformed shell syntax; Code Zero then applies its deliberately narrower argv-only
 * policy and refuses shell operators because execution always uses `shell: false`.
 */
export async function commandArgv(command: string): Promise<[string, string[]]> {
  if (SHELL_OPERATORS.test(command))
    throw new CommandRejectedError(command, 'commands run without a shell');

  const analysis = await analyzeShellCommand(command, { maxInputBytes: 16_384, timeoutMs: 1_000 });
  if (!analysis.ok)
    throw new CommandRejectedError(command, 'ViteHub Shell could not analyze the command');

  const [program, ...args] = splitCommand(command);
  if (!program) throw new CommandRejectedError(command, 'no program to execute');
  return [program, args];
}

/** Parse command syntax with ViteHub without converting it to argv. */
export async function assertSimpleCommand(command: string): Promise<void> {
  await commandArgv(command);
}

/**
 * Tokenize a command only after ViteHub Shell and Code Zero policy have accepted its syntax.
 *
 * `magic-regexp` handles the small argv extraction surface; it is not used as a second shell parser.
 */
export function splitCommand(command: string): string[] {
  const parts = command.match(COMMAND_PARTS) ?? [];
  return parts.map(unquote);
}

function unquote(part: string): string {
  const quote = part[0];
  return (quote === '"' || quote === "'") && part.at(-1) === quote ? part.slice(1, -1) : part;
}
