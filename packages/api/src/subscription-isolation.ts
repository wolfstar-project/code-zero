import { homedir } from 'node:os';
import { join } from 'node:path';

import type { CodeZeroConfig } from '@code-zero/config';
import type { ClaudeCodeProcessSpawner } from '@code-zero/models';
import { spawnManagedProcess, type ManagedProcessMount } from '@code-zero/runner';

/** Where the CLI's own config directory is mounted inside its container, regardless of image layout. */
const CLAUDE_CONFIG_CONTAINER_PATH = '/code-zero/claude-config';

/**
 * The host UID:GID that owns the mounted config files, so the containerized CLI can read them as
 * their owner rather than as an unrelated `root`. `process.getuid`/`getgid` are POSIX-only and
 * absent on Windows, where this is left unset — Docker Desktop's Linux VM does not share Windows'
 * UID/GID model, so there is no equivalent host identity to pass through there.
 */
const hostUidGid: string | undefined =
  process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : undefined;

/**
 * Whether `claude-code`'s CLI process can be isolated the way `runner.isolation: container`
 * requires, and the reason it cannot when it can't.
 *
 * `config.runner.isolation === 'container'` is an explicit operator declaration that command
 * execution must run isolated. The subscription CLI process is not a repository command, but
 * leaving it unisolated while every repository check runs contained would be exactly the silent
 * isolation bypass this exists to prevent.
 */
export function claudeCodeRefusalReason(
  config: CodeZeroConfig,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  if (config.runner.isolation !== 'container') return undefined;
  if (environment.CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE) return undefined;
  return (
    'runner.isolation is "container" but CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE is not set, so ' +
    "the CLI process cannot be isolated the way this deployment's other command execution is."
  );
}

/**
 * Report `claude-code` as unconfigured for diagnostics (`zero doctor`) when it cannot be isolated.
 *
 * `zero doctor` wants a plain "not ready" signal, not the fallback-preserving nuance a real run
 * needs — see `subscriptionRefusalReason` in `runAgent`, which reports the identical unavailability
 * to `modelFromEnvironment` without touching the enable flag, so a configured API-key fallback
 * still gets a turn instead of the run failing outright.
 */
export function environmentForModel(
  config: CodeZeroConfig,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return claudeCodeRefusalReason(config, environment) === undefined
    ? environment
    : { ...environment, CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'false' };
}

/**
 * Build the spawner `modelFromEnvironment` uses for the `claude-code` transport's CLI process.
 *
 * On `local` isolation, the process is spawned on the host through the runner boundary — the same
 * trust level `LocalRunner` already gives repository commands. On `container` isolation, it runs in
 * its own ephemeral container instead: no repository checkout mounted (the CLI never touches one,
 * per its `tools: []`/`mcpServers: {}` settings), unrestricted network (the repository's
 * `permissions.network` policy governs an *untrusted checkout's* commands, not Code Zero's own
 * necessary calls to the vendor API), and the CLI's own config directory — where `claude login`
 * persisted its session on the host — mounted read-only so the container can read that same login
 * state instead of appearing logged out.
 */
export function claudeCodeProcessSpawner(
  config: CodeZeroConfig,
  environment: NodeJS.ProcessEnv,
): ClaudeCodeProcessSpawner {
  if (config.runner.isolation !== 'container')
    return (options) =>
      spawnManagedProcess(options.command, options.args, {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env: options.env,
        signal: options.signal,
      });

  const image = environment.CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE;
  if (!image)
    throw new Error(
      'claudeCodeProcessSpawner requires CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE under container isolation; check claudeCodeRefusalReason first to refuse the transport instead of reaching this.',
    );
  const containerExecutable = environment.CODE_ZERO_CLAUDE_CODE_CONTAINER_EXECUTABLE ?? 'claude';
  const { mounts, configEnv } = claudeConfigMounts(environment.CLAUDE_CONFIG_DIR);

  return (options) =>
    spawnManagedProcess(
      // `options.command` is an absolute path the vendor SDK resolved on the host — its own
      // bundled native binary, or `CODE_ZERO_CLAUDE_CODE_PATH` if set — and that path does not
      // exist inside the container's filesystem. `options.args` carries no host paths (CLI flags
      // and JSON schema text only), so only `command` needs replacing with the CLI the container
      // image actually has installed.
      containerExecutable,
      options.args,
      {
        env: { ...options.env, ...configEnv },
        signal: options.signal,
        container: {
          engine: config.runner.engine,
          image,
          ...(config.runner.cpus === undefined ? {} : { cpus: config.runner.cpus }),
          ...(config.runner.memory === undefined ? {} : { memory: config.runner.memory }),
          // The mounted config directory's files carry the mode (commonly 0600) the CLI wrote them
          // with, and the CLI verifies the reading process owns them before trusting a session — a
          // read syscall from a mismatched UID can still succeed for `root` without this, but the
          // CLI's own check fails regardless and reports the session as logged out. `--cap-drop ALL`
          // means even `root` in the container gets no ownership-bypass capability either, so this
          // has to be the actual host UID, not a fixed in-container user.
          ...(hostUidGid ? { user: hostUidGid } : {}),
          mounts,
        },
      },
    );
}

/**
 * Mount the CLI's login session into the container, wherever the host actually keeps it.
 *
 * With `CLAUDE_CONFIG_DIR` unset (the common case), the CLI splits its state across two host
 * locations that are not nested inside each other: `~/.claude/` (credentials, settings, cache) and
 * a sibling file, `~/.claude.json` (project/session record). Docker cannot bind-mount that file to
 * a path inside the `~/.claude/` mount — creating a new mountpoint inside an already-`:ro` bind
 * fails at the OCI runtime level — so both are mounted as siblings under one synthetic directory
 * instead, with the container's `$HOME` pointed at that directory so the CLI's own default
 * resolution (`$HOME/.claude`, `$HOME/.claude.json`) finds them without any `CLAUDE_CONFIG_DIR`
 * override. An operator who already set `CLAUDE_CONFIG_DIR` on the host is presumed to already keep
 * both files together under that one directory, so a single mount plus the matching override
 * suffices there.
 */
function claudeConfigMounts(hostConfigDirOverride: string | undefined): {
  mounts: ManagedProcessMount[];
  configEnv: NodeJS.ProcessEnv;
} {
  if (hostConfigDirOverride)
    return {
      mounts: [{ hostPath: hostConfigDirOverride, containerPath: CLAUDE_CONFIG_CONTAINER_PATH }],
      configEnv: { CLAUDE_CONFIG_DIR: CLAUDE_CONFIG_CONTAINER_PATH },
    };
  const hostConfigDir = join(homedir(), '.claude');
  return {
    mounts: [
      { hostPath: hostConfigDir, containerPath: `${CLAUDE_HOME_CONTAINER_PATH}/.claude` },
      {
        hostPath: `${hostConfigDir}.json`,
        containerPath: `${CLAUDE_HOME_CONTAINER_PATH}/.claude.json`,
      },
    ],
    configEnv: { HOME: CLAUDE_HOME_CONTAINER_PATH },
  };
}

/** Synthetic $HOME for the default (unset CLAUDE_CONFIG_DIR) mount layout; see claudeConfigMounts. */
const CLAUDE_HOME_CONTAINER_PATH = '/code-zero/claude-home';
