import { spawn } from 'node:child_process';

import { APICallError, generateText } from 'ai';
import { describe, expect, it } from 'vitest';

import {
  createSubscriptionSession,
  isSubscriptionModelProvider,
  isSubscriptionProviderEnabled,
  modelProviderCredentialKind,
  parseLimitReset,
  providerStderr,
  subscriptionLanguageModel,
  subscriptionProbeCommand,
  subscriptionProviderDescriptor,
  SubscriptionLimitReachedError,
  SubscriptionProviderUnavailableError,
  translateSubscriptionError,
  type ClaudeCodeProcessSpawner,
} from './subscription.js';

/** A fixed clock, so a reported delay resolves to the same instant on every run. */
const NOW = () => Date.parse('2026-08-15T12:00:00.000Z');

/** Matches the vendor SDK's real failure once a stand-in executable's protocol mismatches. */
const CLI_EXITED = /exited/iu;

/** Asserts the classification and narrows it, so the reset instant can be read without a cast. */
function limitError(value: Error | undefined): SubscriptionLimitReachedError {
  expect(value).toBeInstanceOf(SubscriptionLimitReachedError);
  if (!(value instanceof SubscriptionLimitReachedError)) throw new Error('unreachable');
  return value;
}

/** The shape a CLI-backed transport raises when its subprocess exits non-zero. */
function cliExit(stderr: string): APICallError {
  return new APICallError({
    message: 'Codex CLI exited with code 1',
    url: 'codex-cli://exec',
    requestBodyValues: {},
    data: { exitCode: 1, stderr },
  });
}

describe('modelProviderCredentialKind', () => {
  it('separates CLI-backed transports from metered ones', () => {
    expect(modelProviderCredentialKind('claude-code')).toBe('subscription');
    expect(modelProviderCredentialKind('codex-cli')).toBe('subscription');
    for (const provider of [
      'ai-gateway',
      'anthropic',
      'google',
      'openai',
      'openai-compatible',
    ] as const)
      expect(modelProviderCredentialKind(provider)).toBe('api-key');
  });

  it('agrees with the type guard', () => {
    expect(isSubscriptionModelProvider('claude-code')).toBe(true);
    expect(isSubscriptionModelProvider('anthropic')).toBe(false);
  });
});

describe('isSubscriptionProviderEnabled', () => {
  it('spawns a CLI only for an exact opt-in', () => {
    const flag = subscriptionProviderDescriptor('claude-code').enableEnvironmentVariable;
    expect(isSubscriptionProviderEnabled('claude-code', { [flag]: 'true' })).toBe(true);
    for (const value of ['', '1', 'TRUE', 'yes', 'false', ' true'])
      expect(isSubscriptionProviderEnabled('claude-code', { [flag]: value })).toBe(false);
    expect(isSubscriptionProviderEnabled('claude-code', {})).toBe(false);
  });

  it('gates each provider on its own flag', () => {
    const claude = subscriptionProviderDescriptor('claude-code').enableEnvironmentVariable;
    expect(isSubscriptionProviderEnabled('codex-cli', { [claude]: 'true' })).toBe(false);
  });
});

describe('subscriptionProbeCommand', () => {
  it('probes the PATH executable and only asks it for a version', () => {
    expect(subscriptionProbeCommand('claude-code', {})).toBe('claude --version');
    expect(subscriptionProbeCommand('codex-cli', {})).toBe('codex --version');
  });

  it('quotes an operator override so a path with spaces stays one argument', () => {
    expect(subscriptionProbeCommand('codex-cli', { CODE_ZERO_CODEX_PATH: '/opt/bin/codex' })).toBe(
      '/opt/bin/codex --version',
    );
    expect(
      subscriptionProbeCommand('codex-cli', { CODE_ZERO_CODEX_PATH: '/opt/my tools/codex' }),
    ).toBe('"/opt/my tools/codex" --version');
  });

  it('switches to single quotes for a path the double-quote grammar cannot express', () => {
    // The runner's command parser has no escaping: a literal `"` inside a `"..."` token reads as
    // the token's end, so `LocalRunner.check` would reject this and doctor would misreport the
    // CLI as missing. Single-quoting it is what a real shell would do too.
    expect(
      subscriptionProbeCommand('codex-cli', { CODE_ZERO_CODEX_PATH: '/tmp/vendor" cli/probe' }),
    ).toBe(`'/tmp/vendor" cli/probe' --version`);
  });

  it('keeps double-quoting a path that merely contains an apostrophe', () => {
    expect(
      subscriptionProbeCommand('codex-cli', { CODE_ZERO_CODEX_PATH: "/opt/user's tools/codex" }),
    ).toBe(`"/opt/user's tools/codex" --version`);
  });

  it('refuses a path no quoting can express, rather than probing a truncated one', () => {
    expect(() =>
      subscriptionProbeCommand('codex-cli', {
        CODE_ZERO_CODEX_PATH: `/tmp/both" and' quotes/codex`,
      }),
    ).toThrow('CODE_ZERO_CODEX_PATH contains both a single and a double quote');
  });
});

describe('subscriptionLanguageModel', () => {
  // `ai-sdk-provider-codex-cli@2` throws its spawn ENOENT from a `child.on('error')` handler, so
  // it escapes the awaited promise and kills the process. Resolving the executable first is what
  // keeps a misconfigured provider from taking the control plane down with it.
  it('refuses a missing executable instead of letting the vendor SDK spawn it', async () => {
    const build = subscriptionLanguageModel('codex-cli', 'gpt-5.2-codex', {
      CODE_ZERO_CODEX_PATH: '/nonexistent/codex',
    });
    await expect(build()).rejects.toBeInstanceOf(SubscriptionProviderUnavailableError);
    await expect(build()).rejects.toThrow('not installed or not on PATH');
  });

  it('refuses a name that resolves nowhere on PATH', async () => {
    const build = subscriptionLanguageModel('claude-code', 'opus', { PATH: '/nonexistent/bin' });
    await expect(build()).rejects.toThrow('not installed or not on PATH');
  });

  it('accepts an executable that exists and is runnable', async () => {
    // `node` is guaranteed present wherever this suite runs, and is never spawned here: the
    // factory only builds the model.
    const build = subscriptionLanguageModel('claude-code', 'opus', {
      CODE_ZERO_CLAUDE_CODE_PATH: process.execPath,
    });
    await expect(build()).resolves.toBeDefined();
  });

  it('spawns the claude-code CLI through the supplied spawner, not the vendor default', async () => {
    // Reproduces the security finding this closes: without a spawner, the vendor SDK calls
    // `child_process.spawn` itself, outside the runner boundary. `process.execPath` stands in for
    // `claude` so this runs offline — the call still reaches a real spawn and a real (expected)
    // protocol failure, it just never talks to a network or an actual CLI installation.
    let spawnedCommand: string | undefined;
    const spawnProcess: ClaudeCodeProcessSpawner = (options) => {
      spawnedCommand = options.command;
      return spawn(options.command, options.args, { stdio: 'pipe' });
    };
    const build = subscriptionLanguageModel(
      'claude-code',
      'opus',
      { CODE_ZERO_CLAUDE_CODE_PATH: process.execPath },
      undefined,
      spawnProcess,
    );
    const model = await build();
    // Node itself is not the Claude Code CLI, so the call fails once the protocol mismatches —
    // after the spawn already happened, which is the only thing this test needs to prove.
    await expect(
      generateText({ model, prompt: 'irrelevant: the spawner intercepts before this matters' }),
    ).rejects.toThrow(CLI_EXITED);
    expect(spawnedCommand).toBe(process.execPath);
  });

  it('does not probe the host PATH when a spawner is supplied: the executable may only exist in a container', async () => {
    // A composition root's containerized spawner runs the CLI inside a configured image; the host
    // running Code Zero never needs `claude` installed at all. Probing the host PATH here would
    // refuse a correctly configured containerized transport before the spawner ever ran.
    let spawnedCommand: string | undefined;
    const spawnProcess: ClaudeCodeProcessSpawner = (options) => {
      spawnedCommand = options.command;
      return spawn(process.execPath, options.args, { stdio: 'pipe' });
    };
    const build = subscriptionLanguageModel(
      'claude-code',
      'opus',
      { PATH: '/nonexistent/bin' },
      undefined,
      spawnProcess,
    );
    const model = await build();
    await expect(
      generateText({ model, prompt: 'irrelevant: the spawner intercepts before this matters' }),
    ).rejects.toThrow(CLI_EXITED);
    // Reaching a real spawn attempt (rather than the pre-flight PATH check's error) proves the
    // check was skipped, not that it happened to pass.
    expect(spawnedCommand).toBeDefined();
  });

  it('still probes the host PATH for codex-cli, which has no custom spawner to take over error handling', async () => {
    // ai-sdk-provider-codex-cli@2 crashes the process on an unhandled spawn ENOENT; only the
    // pre-flight check here prevents that, and codex-cli never gets a spawner to skip it with.
    const build = subscriptionLanguageModel('codex-cli', 'gpt-5.2-codex', {
      CODE_ZERO_CODEX_PATH: '/nonexistent/codex',
      PATH: '/nonexistent/bin',
    });
    await expect(build()).rejects.toBeInstanceOf(SubscriptionProviderUnavailableError);
  });

  it('refuses immediately with the supplied reason, never touching the vendor SDK or the host PATH', async () => {
    // A composition root that has already decided this run cannot use the transport (a RunnerPool
    // lease its CLI process cannot be routed through, for one) reports that here — before the
    // executable probe, so a host with no CLI installed at all still refuses with this reason
    // rather than the unrelated "not installed or not on PATH" message.
    const build = subscriptionLanguageModel(
      'claude-code',
      'opus',
      { PATH: '/nonexistent/bin' },
      undefined,
      undefined,
      'A RunnerPool lease is active for this task.',
    );
    await expect(build()).rejects.toBeInstanceOf(SubscriptionProviderUnavailableError);
    await expect(build()).rejects.toThrow('A RunnerPool lease is active for this task.');
  });
});

describe('translateSubscriptionError', () => {
  it('names the install fix when the CLI is not on PATH', async () => {
    const spawnFailure = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    const translated = await translateSubscriptionError('codex-cli')(
      new Error('wrapped', { cause: spawnFailure }),
      'redacted detail',
    );
    expect(translated).toBeInstanceOf(SubscriptionProviderUnavailableError);
    expect(translated?.message).toContain('codex CLI is not installed');
    expect(translated?.message).toContain('CODE_ZERO_CODEX_PATH');
    expect(translated?.message).toContain('redacted detail');
  });

  it('names the login command when the session expired', async () => {
    // The vendor predicate is the contract, so build the shape it recognizes rather than a
    // message this test invented.
    const { createAuthenticationError } = await import('ai-sdk-provider-claude-code');
    const translated = await translateSubscriptionError('claude-code')(
      createAuthenticationError({ message: 'not logged in' }),
      'redacted detail',
    );
    expect(translated).toBeInstanceOf(SubscriptionProviderUnavailableError);
    expect(translated?.message).toContain('claude login');
  });

  it('recognizes an expired session the vendor predicate misses', async () => {
    // Captured from a real expired `codex login`: the CLI exits non-zero with no structured error
    // code, which is exactly the shape `isAuthenticationError` returns false for.
    const translated = await translateSubscriptionError('codex-cli')(
      cliExit(
        'failed to refresh available models: unexpected status 401 Unauthorized: Provided authentication token is expired.\nauth error code: token_expired\n',
      ),
      'redacted detail',
    );
    expect(translated).toBeInstanceOf(SubscriptionProviderUnavailableError);
    expect(translated?.message).toContain('codex login');
  });

  it('leaves every other failure to the default error path', async () => {
    expect(
      await translateSubscriptionError('claude-code')(new Error('rate limited'), 'detail'),
    ).toBeUndefined();
  });

  it('does not blame the session for an upstream failure that merely mentions a status', async () => {
    // Also captured live: a model the account cannot use. Telling an operator to log in again
    // here would send them to fix the one thing that is not broken.
    expect(
      await translateSubscriptionError('codex-cli')(
        cliExit(
          '{"type":"error","status":400,"error":{"message":"The \'gpt-5.2-codex\' model is not supported when using Codex with a ChatGPT account."}}',
        ),
        'detail',
      ),
    ).toBeUndefined();
  });

  it('reads stderr only from the transport, never from an arbitrary error', () => {
    expect(providerStderr(new Error('spawn failed'))).toBe('');
    expect(providerStderr(cliExit('boom'))).toBe('boom');
  });

  it('keeps the tail of an overlong stderr, where the failure is reported', () => {
    const stderr = `${'noise\n'.repeat(2_000)}auth error code: token_expired`;
    const captured = providerStderr(cliExit(stderr));
    expect(captured).toContain('token_expired');
    expect(captured).toContain('[truncated');
    expect(captured.length).toBeLessThan(stderr.length);
  });

  it('stops walking a self-referential cause chain', async () => {
    const looping: { cause?: unknown } = {};
    looping.cause = looping;
    expect(await translateSubscriptionError('codex-cli')(looping, 'detail')).toBeUndefined();
  });
});

describe('parseLimitReset', () => {
  const now = Date.parse('2026-08-15T12:00:00.000Z');

  it('reads the reset instant Codex serializes beside the rejection', () => {
    expect(
      parseLimitReset('{"type":"usage_limit_reached","resets_at":"2026-08-15T17:30:00Z"}', now),
    ).toEqual(new Date('2026-08-15T17:30:00Z'));
  });

  it('reads an epoch reset in either unit the transports use', () => {
    const seconds = parseLimitReset('resets_at=1786000000', now);
    const milliseconds = parseLimitReset('"resetsAt": 1786000000000', now);
    expect(seconds).toEqual(new Date(1_786_000_000_000));
    expect(seconds).toEqual(milliseconds);
  });

  it('turns a reported delay into an instant relative to the caller, not the clock', () => {
    expect(parseLimitReset('{"reset_after_seconds":900}', now)).toEqual(new Date(now + 900_000));
    expect(parseLimitReset('retry-after: 60', now)).toEqual(new Date(now + 60_000));
  });

  it('reports nothing rather than guessing at prose', () => {
    // Waiting on a duration nobody stated is worse than saying the reset is unknown: the run
    // blocks for an interval no operator chose.
    expect(parseLimitReset('usage limit reached, try again later today', now)).toBeUndefined();
    expect(parseLimitReset('resets_at: not-a-time', now)).toBeUndefined();
  });
});

describe('translateSubscriptionError on a spent usage window', () => {
  it('prefers the rejection the Agent SDK reported over anything it printed', async () => {
    const session = createSubscriptionSession();
    session.rejected = true;
    session.resetsAt = new Date('2026-08-15T14:00:00.000Z');
    const translated = await translateSubscriptionError(
      'claude-code',
      session,
      NOW,
    )(new Error('Claude Code SDK error'), 'detail');
    expect(limitError(translated).resetsAt).toEqual(new Date('2026-08-15T14:00:00.000Z'));
    expect(translated?.message).toContain('2026-08-15T14:00:00.000Z');
  });

  it('recognizes the condition from a bare Codex exit, which reports no rejection event', async () => {
    const translated = await translateSubscriptionError(
      'codex-cli',
      undefined,
      NOW,
    )(
      cliExit('{"error":{"type":"usage_limit_reached","resets_at":"2026-08-15T18:00:00Z"}}'),
      'Codex CLI exited with code 1',
    );
    expect(limitError(translated).resetsAt).toEqual(new Date('2026-08-15T18:00:00Z'));
  });

  it('still classifies the limit when no reset instant was reported', async () => {
    const translated = await translateSubscriptionError(
      'codex-cli',
      undefined,
      NOW,
    )(cliExit('Usage limit reached. Increase your limits to continue using codex.'), 'detail');
    expect(limitError(translated).resetsAt).toBeUndefined();
    expect(translated?.message).toContain('did not report when the window reopens');
  });

  it('sends an operator to the limit, not to a pointless re-login', async () => {
    // A spent plan and an expired login both talk about usage and credentials. Classifying this
    // as authentication would tell someone to fix the one thing that is not broken.
    const { createAuthenticationError } = await import('ai-sdk-provider-claude-code');
    const translated = await translateSubscriptionError(
      'claude-code',
      undefined,
      NOW,
    )(
      createAuthenticationError({ message: "You've reached your usage limit" }),
      "You've reached your usage limit",
    );
    expect(translated).toBeInstanceOf(SubscriptionLimitReachedError);
  });

  it('leaves an expired login classified as authentication', async () => {
    const { createAuthenticationError } = await import('ai-sdk-provider-claude-code');
    const translated = await translateSubscriptionError(
      'claude-code',
      undefined,
      NOW,
    )(createAuthenticationError({ message: 'OAuth token revoked' }), 'OAuth token revoked');
    expect(translated).toBeInstanceOf(SubscriptionProviderUnavailableError);
    expect(translated).not.toBeInstanceOf(SubscriptionLimitReachedError);
    expect(translated?.message).toContain('claude login');
  });
});
