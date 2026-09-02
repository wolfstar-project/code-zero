import type { ChildProcess } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join, sep } from 'node:path';

import {
  truncateTail,
  type ModelProviderCredentialKind,
  type ModelProviderKind,
} from '@code-zero/shared';
import { APICallError, type LanguageModel } from 'ai';

/**
 * Model transports that spawn a locally authenticated vendor CLI instead of calling a metered API.
 *
 * These carry no credential Code Zero can read, rotate, or redact: the session lives in the CLI's
 * own on-disk state, established interactively by the operator. That makes them single-tenant by
 * construction, which is why they stay behind an explicit operator flag.
 */
export type SubscriptionModelProviderKind = 'claude-code' | 'codex-cli';

export interface SubscriptionProviderDescriptor {
  /** Operator flag that must be exactly `true` before the CLI may be spawned. */
  enableEnvironmentVariable: string;
  /** Operator override used when the CLI is not on `PATH`. */
  executableEnvironmentVariable: string;
  /** Executable resolved from `PATH` when no override is set. */
  executable: string;
  /** Command an operator runs to re-establish the CLI session. */
  loginCommand: string;
  /** Flag that makes the CLI prove it is runnable and exit. Never starts a session. */
  probeArgument: string;
}

const descriptors = {
  'claude-code': {
    enableEnvironmentVariable: 'CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER',
    executableEnvironmentVariable: 'CODE_ZERO_CLAUDE_CODE_PATH',
    executable: 'claude',
    loginCommand: 'claude login',
    probeArgument: '--version',
  },
  'codex-cli': {
    enableEnvironmentVariable: 'CODE_ZERO_ENABLE_CODEX_CLI_PROVIDER',
    executableEnvironmentVariable: 'CODE_ZERO_CODEX_PATH',
    executable: 'codex',
    loginCommand: 'codex login',
    probeArgument: '--version',
  },
} as const satisfies Record<SubscriptionModelProviderKind, SubscriptionProviderDescriptor>;

/**
 * A subscription transport that cannot serve this run.
 *
 * Raised for the failures an operator can act on — the CLI is missing, its session expired, or the
 * plan's usage window is spent — so the message names the remedy instead of surfacing a spawn or
 * protocol error. A caller that has somewhere else to go degrades on this type and nothing else.
 */
export class SubscriptionProviderUnavailableError extends Error {
  readonly provider: SubscriptionModelProviderKind;

  constructor(provider: SubscriptionModelProviderKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SubscriptionProviderUnavailableError';
    this.provider = provider;
  }
}

/**
 * The plan's usage window is spent.
 *
 * Distinct from the other unavailable reasons because it is the only one that fixes itself: the
 * window reopens at `resetsAt`, and the interrupted CLI session can be resumed from there rather
 * than restarted. `resetsAt` is absent when the transport reported the rejection without saying
 * when it lifts, which is the one case a caller cannot wait out.
 */
export class SubscriptionLimitReachedError extends SubscriptionProviderUnavailableError {
  readonly resetsAt: Date | undefined;

  constructor(
    provider: SubscriptionModelProviderKind,
    message: string,
    resetsAt: Date | undefined,
    options?: ErrorOptions,
  ) {
    super(provider, message, options);
    this.name = 'SubscriptionLimitReachedError';
    this.resetsAt = resetsAt;
  }
}

/**
 * What one run learned about the CLI session it is driving.
 *
 * The vendor SDKs report the session id and the plan's limit state out of band, as events on the
 * running query rather than as call results, so a run collects them here as they arrive. Holding
 * them is what lets an interrupted call resume the same session instead of opening a new one and
 * paying for the conversation twice.
 */
export interface SubscriptionSession {
  /** Session the last call ran in, captured from the transport's own events. */
  id: string | undefined;
  /** Session the next call should continue. Set only after an interruption worth resuming. */
  resume: string | undefined;
  /** When the plan's window reopens, as last reported by the transport. */
  resetsAt: Date | undefined;
  /** Whether the transport's most recent report was an outright rejection. */
  rejected: boolean;
}

export function createSubscriptionSession(): SubscriptionSession {
  return { id: undefined, resume: undefined, resetsAt: undefined, rejected: false };
}

/**
 * Spawns the Claude Code CLI process on the vendor SDK's behalf.
 *
 * `packages/models` never calls `child_process` itself: this is the vendor SDK's own
 * `spawnClaudeCodeProcess` hook, structurally typed against Node's `ChildProcess` rather than
 * against the vendor's re-exported type names (`ai-sdk-provider-claude-code` does not publicly
 * export `SpawnOptions`/`SpawnedProcess`, and `ChildProcess` already satisfies the vendor's shape
 * per its own documentation). A composition root supplies an implementation backed by
 * `@code-zero/runner`'s `spawnManagedProcess`, so the CLI this transport drives is spawned through
 * the same boundary as every other command Code Zero runs, not through the vendor SDK's own
 * default `child_process.spawn` call.
 */
export type ClaudeCodeProcessSpawner = (options: {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}) => ChildProcess;

export function isSubscriptionModelProvider(
  provider: ModelProviderKind,
): provider is SubscriptionModelProviderKind {
  return provider === 'claude-code' || provider === 'codex-cli';
}

export function modelProviderCredentialKind(
  provider: ModelProviderKind,
): ModelProviderCredentialKind {
  return isSubscriptionModelProvider(provider) ? 'subscription' : 'api-key';
}

export function subscriptionProviderDescriptor(
  provider: SubscriptionModelProviderKind,
): SubscriptionProviderDescriptor {
  return descriptors[provider];
}

/**
 * Whether the operator opted this host into spawning the vendor CLI.
 *
 * The comparison is exact so an unset, empty, or accidentally truthy value ("0", "false") leaves
 * the provider off: a CI runner that never installed the CLI must not start subprocesses.
 */
export function isSubscriptionProviderEnabled(
  provider: SubscriptionModelProviderKind,
  environment: NodeJS.ProcessEnv,
): boolean {
  return environment[descriptors[provider].enableEnvironmentVariable] === 'true';
}

/**
 * The command that proves the CLI is installed and runnable.
 *
 * Returned rather than executed: `packages/models` never spawns anything itself, so a composition
 * root runs this through the runner boundary like every other command.
 */
export function subscriptionProbeCommand(
  provider: SubscriptionModelProviderKind,
  environment: NodeJS.ProcessEnv,
): string {
  const descriptor = descriptors[provider];
  const executable = environment[descriptor.executableEnvironmentVariable] ?? descriptor.executable;
  const program = quoteProbeExecutable(executable, descriptor);
  return `${program} ${descriptor.probeArgument}`;
}

/**
 * Quote an executable path for the runner's command-string surface, only when it needs it.
 *
 * The runner's parser accepts a `"..."` or `'...'` token but supports no escaping inside either —
 * embedding the same quote character the token uses is not expressible at all. Wrapping
 * unconditionally in double quotes therefore breaks on a path that itself contains a literal `"`:
 * the parser reads the embedded quote as closing the token early, `LocalRunner.check` rejects the
 * resulting command, and `zero doctor` reports a perfectly good CLI as not installed. Choosing
 * whichever quote character the path does not contain avoids that for every path but one.
 */
function quoteProbeExecutable(
  executable: string,
  descriptor: SubscriptionProviderDescriptor,
): string {
  if (!WHITESPACE.test(executable)) return executable;
  if (!executable.includes('"')) return `"${executable}"`;
  if (!executable.includes("'")) return `'${executable}'`;
  // A path with both quote characters and a space has no token this parser can express; refusing
  // loudly here is better than probing a truncated path and reporting a working CLI as missing.
  throw new Error(
    `${descriptor.executableEnvironmentVariable} contains both a single and a double quote, and a space: no probe command can express that path safely.`,
  );
}

const WHITESPACE = /\s/u;

/**
 * Build the language model lazily, once per call.
 *
 * The vendor SDKs are several megabytes and are irrelevant to every run that uses an API-key
 * transport, so they are imported on first use rather than at module load; Node caches the module,
 * so later builds cost an executable lookup and an object. Rebuilding per call is what lets a
 * retry pick up `session.resume`, which is only known after the interrupted call failed.
 */
export function subscriptionLanguageModel(
  provider: SubscriptionModelProviderKind,
  model: string,
  environment: NodeJS.ProcessEnv,
  session: SubscriptionSession = createSubscriptionSession(),
  spawnProcess?: ClaudeCodeProcessSpawner,
  /**
   * When set, every call refuses immediately with this reason instead of building a model at all —
   * for a composition root that has determined this transport cannot serve the run (a `RunnerPool`
   * lease it cannot route the CLI process through, for one), but still wants a configured API-key
   * fallback to get its turn rather than the run failing outright. Thrown here, synchronously,
   * before the vendor SDK is ever touched: a vendor SDK that catches and rewraps a thrown error (as
   * `ai-sdk-provider-claude-code` does for a throwing `spawnClaudeCodeProcess`) does not preserve
   * the `SubscriptionProviderUnavailableError` identity `FallbackModelProvider` degrades on, only
   * the message text — this way nothing but this module's own code ever has to produce that error.
   */
  refusalReason?: string,
): () => Promise<LanguageModel> {
  const executable = environment[descriptors[provider].executableEnvironmentVariable];
  return async () => {
    if (refusalReason !== undefined)
      throw new SubscriptionProviderUnavailableError(provider, refusalReason);
    // The host `PATH` check only applies when the vendor SDK will do its own default host spawn.
    // A supplied `spawnProcess` (a composition root's containerized or runner-backed spawner) takes
    // over both spawning and the SpawnedProcess.on('error', ...) handling the vendor SDK relies on —
    // and under container isolation, the executable is only ever expected to exist inside the
    // configured image, never on the control-plane host, so probing the host here would refuse a
    // correctly configured containerized transport before its spawner ever ran.
    if (!(provider === 'claude-code' && spawnProcess))
      await assertExecutableResolves(provider, executable, environment);
    return provider === 'claude-code'
      ? claudeCodeLanguageModel(model, executable, session, spawnProcess)
      : codexCliLanguageModel(model, executable);
  };
}

/**
 * Record what the Agent SDK reports out of band.
 *
 * `onSdkMessage` is the provider's documented escape hatch for subtypes it does not model itself,
 * and the two facts a resumable run needs — the session id and a `rejected` rate-limit window —
 * only arrive that way. The payloads are narrowed structurally rather than against the SDK's
 * message union, so a new subtype cannot turn an observation into a type error.
 */
function observeSdkMessage(session: SubscriptionSession, message: unknown): void {
  if (typeof message !== 'object' || message === null) return;
  const record: Record<string, unknown> = { ...message };
  if (typeof record.session_id === 'string' && record.session_id.length > 0)
    session.id = record.session_id;
  if (record.type !== 'rate_limit_event') return;
  const info = record.rate_limit_info;
  if (typeof info !== 'object' || info === null) return;
  const { status, resetsAt } = info as { status?: unknown; resetsAt?: unknown };
  session.rejected = status === 'rejected';
  session.resetsAt = epochToDate(resetsAt) ?? session.resetsAt;
}

/**
 * Read an epoch stamp whose unit the vendor does not state.
 *
 * Anthropic's rate-limit stamps are seconds while most JavaScript stamps are milliseconds, and
 * misreading one for the other turns a two-minute wait into a fifty-year one. Anything below the
 * threshold is too small to be a plausible millisecond stamp for a current date, so it is seconds.
 */
function epochToDate(value: unknown): Date | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const milliseconds = value < 1e12 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Refuse the transport before the vendor SDK tries to spawn a CLI that is not there.
 *
 * This is not defensive tidiness. `ai-sdk-provider-codex-cli@2` throws its spawn failure from a
 * `child.on('error')` handler, so an `ENOENT` never reaches the awaited promise and takes the host
 * process down as an uncaught exception instead — a misconfigured `model.provider` would stop the
 * control plane rather than fail one run. Resolving the executable first turns that into an
 * ordinary, actionable error.
 *
 * Looking up an executable is not repository access: it reads `PATH`, never a checkout, and starts
 * no process, so it does not belong behind the runner boundary.
 */
async function assertExecutableResolves(
  provider: SubscriptionModelProviderKind,
  override: string | undefined,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const descriptor = descriptors[provider];
  const executable = override ?? descriptor.executable;
  const candidates =
    executable.includes(sep) || executable.includes('/')
      ? [executable]
      : (environment.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .map((entry) => join(entry, executable));
  // An empty PATH with no override leaves nothing to check; let the spawn decide rather than
  // refusing a transport this cannot actually rule out.
  if (candidates.length === 0) return;
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return;
    } catch {
      continue;
    }
  }
  throw new SubscriptionProviderUnavailableError(
    provider,
    `The ${executable} CLI is not installed or not on PATH. Install it, or set ${descriptor.executableEnvironmentVariable} to its absolute path.`,
  );
}

async function claudeCodeLanguageModel(
  model: string,
  executable: string | undefined,
  session: SubscriptionSession,
  spawnProcess: ClaudeCodeProcessSpawner | undefined,
): Promise<LanguageModel> {
  const { createClaudeCode } = await import('ai-sdk-provider-claude-code');
  return createClaudeCode({
    defaultSettings: {
      // Code Zero owns every repository read and write through the runner boundary, so the CLI is
      // reduced to a text generator: no built-in tools, no MCP servers, and the provider already
      // pins `settingSources: []` so nothing on disk can add either back.
      tools: [],
      mcpServers: {},
      permissionMode: 'default',
      // Account-level claude.ai connectors are fetched from the server, so neither an empty
      // `mcpServers` nor a scrubbed environment keeps them out — only this does. Without it a
      // subscription whose account has connectors enabled hands the model tools that reach past
      // the runner boundary, and pays for their definitions on every call.
      settings: { disableClaudeAiConnectors: true },
      onSdkMessage: (message) => {
        observeSdkMessage(session, message);
      },
      // Continue the session the spent window interrupted. `sessionId` is deliberately never set
      // alongside it: the provider rejects that combination.
      ...(session.resume ? { resume: session.resume } : {}),
      ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      // Without this, the vendor SDK spawns the CLI itself via its own default `child_process`
      // call — a runtime command executing outside the runner boundary. When a composition root
      // supplies one, the same boundary that runs every repository check spawns this process too.
      ...(spawnProcess ? { spawnClaudeCodeProcess: adaptSpawnedProcess(spawnProcess) } : {}),
    },
  })(model);
}

/**
 * Bridge a `ChildProcess`-returning spawner to the vendor SDK's own process shape.
 *
 * Structurally, `ChildProcess` (Node's own type) satisfies every individual member the vendor's
 * shape declares, but does not satisfy the interface as a single bulk assignment — an artifact of
 * how the type checker compares several overloaded `EventEmitter` methods (`on`/`once`/`off`)
 * together rather than one at a time. Re-expressing the same members as a plain object literal
 * checks cleanly, so that is what this returns instead of the `ChildProcess` itself.
 */
function adaptSpawnedProcess(spawnProcess: ClaudeCodeProcessSpawner) {
  return (options: Parameters<ClaudeCodeProcessSpawner>[0]) => {
    const child = spawnProcess(options);
    return {
      stdin: child.stdin!,
      stdout: child.stdout!,
      get killed() {
        return child.killed;
      },
      get exitCode() {
        return child.exitCode;
      },
      get signalCode() {
        return child.signalCode;
      },
      kill: (signal: NodeJS.Signals) => child.kill(signal),
      on: child.on.bind(child),
      once: child.once.bind(child),
      off: child.off.bind(child),
    };
  };
}

/**
 * Codex runs in `exec` mode, which cannot resume a thread.
 *
 * `codex exec resume <id>` exists in the CLI, but `ai-sdk-provider-codex-cli@2` always builds a
 * plain `exec` argument vector and exposes no resume setting, so an interrupted Codex call can
 * only be reissued after the window reopens. Claude Code resumes its session properly; the wait
 * itself works for both.
 *
 * Unlike `claudeCodeLanguageModel`, this never receives a spawner: `ai-sdk-provider-codex-cli`
 * exposes no `spawnClaudeCodeProcess`-equivalent hook, so its `child_process.spawn` call cannot be
 * routed through `packages/runner` regardless of the deployment's runner isolation. A containerized
 * runner still runs this CLI's process directly on the control-plane host — the read-only sandbox,
 * disabled approvals, and disabled MCP servers below are the containment for that gap, not a
 * substitute for the process isolation this cannot provide. Documented for operators in README
 * ("Known limits" under the subscription-transports section) as well as here.
 */
async function codexCliLanguageModel(
  model: string,
  executable: string | undefined,
): Promise<LanguageModel> {
  const { createCodexCli } = await import('ai-sdk-provider-codex-cli');
  return createCodexCli({
    defaultSettings: {
      // Same boundary as Claude Code: read-only sandbox, no MCP tools, no approval prompts to
      // answer, and no dependency on the process happening to sit inside a Git checkout.
      sandboxMode: 'read-only',
      approvalMode: 'never',
      mcpServers: {},
      skipGitRepoCheck: true,
      webSearch: false,
      ...(executable ? { codexPath: executable } : {}),
    },
  })(model);
}

/** Whether the transport refused because the plan's usage window is spent. */
const LIMIT_REACHED =
  /usage[ _-]?limit[ _-]?(?:reached|exceeded)|(?:you(?:'ve| have) (?:hit|reached) your)|rate[ _-]?limit[ _-]?(?:reached|exceeded)|too many requests/iu;

/**
 * When the window reopens, as the transports actually report it.
 *
 * Codex serializes `resets_at` (an ISO stamp or an epoch) and `reset_after_seconds`; HTTP layers
 * underneath either CLI use `retry-after`. Each pattern targets a named field rather than loose
 * prose, so a sentence that merely mentions a time cannot be mistaken for a reset.
 */
const RESET_PATTERNS = [
  /"?resets?_?at"?\s*[:=]\s*"([^"]+)"/iu,
  /"?resets?_?at"?\s*[:=]\s*(\d{9,13})\b/iu,
  /"?(?:reset_after|resets_in|retry[_-]?after)(?:_seconds)?"?\s*[:=]\s*"?(\d+)"?/iu,
] as const;

/**
 * Read the reset instant out of a transport's own words.
 *
 * Returns nothing rather than guessing: an unknown reset is reported as such, because waiting a
 * made-up interval would block a run for a duration no one chose.
 */
export function parseLimitReset(text: string, now: number): Date | undefined {
  for (const [index, pattern] of RESET_PATTERNS.entries()) {
    const captured = pattern.exec(text)?.[1];
    if (captured === undefined) continue;
    // The third pattern is a duration in seconds; the first two are absolute stamps.
    if (index === 2) return new Date(now + Number(captured) * 1_000);
    const epoch = epochToDate(Number(captured));
    if (epoch) return epoch;
    const parsed = new Date(captured);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

/**
 * Rewrite the failures an operator can act on.
 *
 * `message` arrives already redacted; anything this returns is published in the same places, so it
 * only ever adds text this module wrote itself.
 */
export function translateSubscriptionError(
  provider: SubscriptionModelProviderKind,
  session: SubscriptionSession = createSubscriptionSession(),
  now: () => number = Date.now,
): (error: unknown, message: string) => Promise<Error | undefined> {
  const descriptor = descriptors[provider];
  return async (error, message) => {
    // Already stated in operator terms by the pre-spawn check; re-wrapping would bury it.
    if (error instanceof SubscriptionProviderUnavailableError) return error;
    if (isMissingExecutable(error))
      return new SubscriptionProviderUnavailableError(
        provider,
        `The ${descriptor.executable} CLI is not installed or not on PATH. Install it, or set ${descriptor.executableEnvironmentVariable} to its absolute path.\n${message}`,
        { cause: error },
      );
    // Checked before authentication: a spent plan and an expired login both mention credentials
    // and usage, and sending an operator to `login` for a limit they simply have to wait out is
    // the more expensive mistake of the two.
    const limit = limitReached(provider, error, message, session, now());
    if (limit) return limit;
    if (await isSessionExpired(provider, error))
      return new SubscriptionProviderUnavailableError(
        provider,
        `The ${descriptor.executable} CLI session is not authenticated. Run \`${descriptor.loginCommand}\` on this host.\n${message}`,
        { cause: error },
      );
    return undefined;
  };
}

/**
 * Classify a spent usage window, preferring what the transport stated over what it printed.
 *
 * A `rejected` rate-limit event is unambiguous and carries the reset instant, so it wins. Text is
 * the fallback for Codex, whose exec mode reports the same condition as an ordinary non-zero exit.
 */
function limitReached(
  provider: SubscriptionModelProviderKind,
  error: unknown,
  message: string,
  session: SubscriptionSession,
  now: number,
): SubscriptionLimitReachedError | undefined {
  const text = `${message}\n${providerStderr(error)}`;
  if (!session.rejected && !LIMIT_REACHED.test(text)) return undefined;
  const resetsAt = session.resetsAt ?? parseLimitReset(text, now);
  const descriptor = descriptors[provider];
  const when = resetsAt
    ? `The window reopens at ${resetsAt.toISOString()}.`
    : 'The transport did not report when the window reopens.';
  return new SubscriptionLimitReachedError(
    provider,
    `The ${descriptor.executable} subscription usage limit is reached. ${when}\n${message}`,
    resetsAt,
    { cause: error },
  );
}

/**
 * Both vendor packages ship an `isAuthenticationError` predicate; ask it first, since it is the
 * only stable contract. It is not sufficient on its own: the Codex predicate reads a structured
 * error code the CLI does not always set, so a genuinely expired session can arrive as a bare
 * non-zero exit whose only evidence is the stderr the transport captured.
 *
 * Reaching here means a call was already attempted, so the dynamic import resolves from cache —
 * unless that import is itself what failed, in which case the original error is the useful one and
 * must not be replaced by a second import failure.
 */
async function isSessionExpired(
  provider: SubscriptionModelProviderKind,
  error: unknown,
): Promise<boolean> {
  try {
    const { isAuthenticationError } =
      provider === 'claude-code'
        ? await import('ai-sdk-provider-claude-code')
        : await import('ai-sdk-provider-codex-cli');
    if (isAuthenticationError(error)) return true;
  } catch {
    return false;
  }
  return AUTHENTICATION_STDERR.test(providerStderr(error));
}

/**
 * Phrases that only an authentication failure produces.
 *
 * Deliberately narrow: a false positive would tell an operator to log in again while the real
 * fault was something else, and would hand a run to the fallback transport for a reason that
 * fallback cannot fix. A bare `401` is not enough, because a CLI echoes upstream status codes for
 * failures that have nothing to do with its own session.
 */
const AUTHENTICATION_STDERR =
  /token[_ ]expired|invalid[_ ]api[_ ]key|401 unauthorized|not (?:logged in|authenticated)|(?:run|use) `?(?:claude|codex) login/iu;

/**
 * The diagnostics a CLI-backed transport captured from the subprocess.
 *
 * A CLI reports why it exited on stderr, not in an HTTP body, so without this an expired session
 * reaches an operator as nothing but "exited with code 1". Callers fold it into the same redacted
 * detail as a response body; it is never surfaced raw.
 */
export function providerStderr(error: unknown): string {
  if (!APICallError.isInstance(error)) return '';
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null || !('stderr' in data)) return '';
  const { stderr } = data;
  return typeof stderr === 'string' ? truncateTail(stderr, MAX_PROVIDER_STDERR) : '';
}

const MAX_PROVIDER_STDERR = 4_000;

/** A spawn that never produced a process, however deep the vendor SDK wrapped it. */
function isMissingExecutable(error: unknown): boolean {
  for (let current = error, depth = 0; current !== undefined && depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ((current as { code?: unknown }).code === 'ENOENT') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
