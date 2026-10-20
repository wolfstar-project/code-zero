import { spawn } from 'node:child_process';

import type { AgentDecision, ReviewInput } from '@code-zero/shared';
import { describe, expect, it } from 'vitest';

import {
  AISdkModelProvider,
  createSubscriptionSession,
  FallbackModelProvider,
  isModelConfigured,
  isAgentDecision,
  modelCredentialEnvironmentVariables,
  modelFromEnvironment,
  OpenAICompatibleProvider,
  renderPrompt,
  ResumingSubscriptionProvider,
  SubscriptionLimitReachedError,
  SubscriptionProviderUnavailableError,
  UnconfiguredModelProvider,
  type ClaudeCodeProcessSpawner,
  type ModelContext,
  type ModelProvider,
} from './index.js';

const decision: AgentDecision = {
  finding: {
    title: 'Null return',
    explanation: 'load() returns null.',
    severity: 'high',
    confidence: 0.9,
    valid: true,
    evidence: ['`return null;`'],
    files: ['src/user.ts'],
  },
  changeRisk: 'mechanical',
  plan: ['Guard the null return'],
  changes: [{ path: 'src/user.ts', content: 'export const load = () => ({});\n', reason: 'guard' }],
};

const REDACTED_MARKER = /\[redacted]/;
const NON_DURATION_WAIT = /must be a non-negative number of milliseconds/;
const INCOMPLETE_FALLBACK = /must be set together/;
const SUBSCRIPTION_FALLBACK = /must be an API-key provider/;
const UNKNOWN_FALLBACK = /Invalid CODE_ZERO_MODEL_FALLBACK_PROVIDER/;
const CLI_EXITED = /exited/iu;

const input: ReviewInput = {
  repository: '/checkout',
  feedback: 'load() can return null',
  mode: 'observe',
};

function context(overrides: Partial<ModelContext> = {}): ModelContext {
  return { input, repositoryContext: 'FILES\nsrc/user.ts\n\nDIFF\n', ...overrides };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function chatResponse(
  content: string,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): Response {
  return jsonResponse({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    ...(usage ? { usage } : {}),
  });
}

describe('renderPrompt', () => {
  it('fences untrusted feedback instead of concatenating it into instructions', () => {
    const prompt = renderPrompt(context());
    expect(prompt).toContain('<untrusted-review-feedback>');
    expect(prompt).toContain('load() can return null');
    expect(prompt.indexOf('<repository-context>')).toBeLessThan(
      prompt.indexOf('<untrusted-review-feedback>'),
    );
  });

  it('renders structured review items with their author and location', () => {
    const prompt = renderPrompt(
      context({
        input: {
          ...input,
          items: [
            {
              id: '1',
              kind: 'review-comment',
              body: 'This can be null',
              author: 'alice',
              requestedChanges: true,
              path: 'src/user.ts',
              line: 2,
            },
          ],
        },
      }),
    );
    expect(prompt).toContain('[review-comment (changes requested) by alice on src/user.ts:2]');
  });

  it('requests independent diff analysis without inventing feedback for a proactive review', () => {
    const prompt = renderPrompt(
      context({ input: { repository: '/checkout', mode: 'observe', trigger: 'proactive' } }),
    );
    expect(prompt).toContain('<review-trigger>');
    expect(prompt).toContain('inspect the supplied pull-request or working-tree diff');
    expect(prompt).not.toContain('<untrusted-review-feedback>');
  });

  it('includes the previous failure only when repairing', () => {
    expect(renderPrompt(context())).not.toContain('<previous-verification-failure>');
    expect(renderPrompt(context({ previousFailure: 'assertion failed' }))).toContain(
      'assertion failed',
    );
  });

  it('never sends a credential to the provider', () => {
    const prompt = renderPrompt(
      context({ repositoryContext: 'export const token = "ghp_0123456789abcdefghijklmnop";' }),
    );
    expect(prompt).not.toContain('ghp_0123456789');
  });
});

describe('OpenAICompatibleProvider', () => {
  it('returns a decision that matches the expected shape', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key-value',
      model: 'gpt-5',
      fetch: async () => chatResponse(JSON.stringify(decision)),
    });
    await expect(provider.decide(context())).resolves.toMatchObject({
      ...decision,
      usage: {
        provider: 'openai-compatible',
        model: 'gpt-5',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    });
  });

  it('sends the key as a bearer header and nothing else', async () => {
    let seen: RequestInit | undefined;
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key-value',
      model: 'gpt-5',
      baseUrl: 'https://example.invalid/v1',
      fetch: async (_url, init) => {
        seen = init;
        return chatResponse(JSON.stringify(decision));
      },
    });
    await provider.decide(context());
    expect(seen?.body).not.toContain('test-key-value');
    expect(seen?.signal).toBeDefined();
  });

  it('records provider usage and computes cost only from configured rates', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key-value',
      model: 'gpt-5',
      inputCostPerMillionTokens: 2,
      outputCostPerMillionTokens: 10,
      fetch: async () =>
        chatResponse(JSON.stringify(decision), {
          prompt_tokens: 1_000,
          completion_tokens: 500,
          total_tokens: 1_500,
        }),
    });
    await expect(provider.decide(context())).resolves.toMatchObject({
      usage: {
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
        costUsd: 0.007,
      },
    });
  });

  it('rejects output that does not match the decision contract', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key-value',
      model: 'gpt-5',
      fetch: async () => chatResponse('{"finding":{"title":"x"}}'),
    });
    await expect(provider.decide(context())).rejects.toThrow('invalid decision');
  });

  it('rejects output that is not JSON at all', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key-value',
      model: 'gpt-5',
      fetch: async () => chatResponse('sure thing!'),
    });
    await expect(provider.decide(context())).rejects.toThrow('not valid JSON');
  });

  it('redacts a failing response body before it becomes an error', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key-value',
      model: 'gpt-5',
      fetch: async () =>
        new Response('rejected authorization: Bearer ghp_0123456789abcdefghijkl', { status: 401 }),
    });
    await expect(provider.decide(context())).rejects.toThrow(REDACTED_MARKER);
  });
});

describe('UnconfiguredModelProvider', () => {
  it('reports the feedback as unvalidated instead of inventing a finding', async () => {
    const result = await new UnconfiguredModelProvider().decide(context());
    expect(result.finding.valid).toBe(false);
    expect(result.finding.confidence).toBe(0);
    expect(result.changes).toEqual([]);
  });
});

describe('modelFromEnvironment', () => {
  it('selects each native provider with its dedicated credential', () => {
    const cases = [
      ['ai-gateway', 'AI_GATEWAY_API_KEY'],
      ['anthropic', 'ANTHROPIC_API_KEY'],
      ['google', 'GOOGLE_GENERATIVE_AI_API_KEY'],
      ['openai', 'OPENAI_API_KEY'],
      ['openai-compatible', 'OPENAI_COMPATIBLE_API_KEY'],
    ] as const;

    for (const [provider, key] of cases) {
      const configured = modelFromEnvironment(
        { provider, name: 'test-model' },
        { [key]: 'test-key-value' },
      );
      expect(configured).toBeInstanceOf(AISdkModelProvider);
      expect(configured).toMatchObject({ provider, model: 'test-model' });
    }
  });

  it('preserves OPENAI_API_KEY compatibility for openai-compatible endpoints', () => {
    expect(
      modelFromEnvironment(
        { provider: 'openai-compatible', name: 'legacy-model' },
        { OPENAI_API_KEY: 'legacy-key-value' },
      ),
    ).toMatchObject({ provider: 'openai-compatible', model: 'legacy-model' });
  });

  it('stays unconfigured when the selected provider credential is absent', () => {
    expect(modelFromEnvironment({ provider: 'anthropic', name: 'claude-test' }, {})).toBeInstanceOf(
      UnconfiguredModelProvider,
    );
    expect(isModelConfigured('anthropic', {})).toBe(false);
  });

  it('documents every accepted credential source', () => {
    expect(modelCredentialEnvironmentVariables('ai-gateway')).toEqual([
      'AI_GATEWAY_API_KEY',
      'VERCEL_OIDC_TOKEN',
    ]);
    expect(modelCredentialEnvironmentVariables('openai-compatible')).toEqual([
      'OPENAI_COMPATIBLE_API_KEY',
      'OPENAI_API_KEY',
    ]);
  });

  it('reports no credential variable for a subscription transport', () => {
    expect(modelCredentialEnvironmentVariables('claude-code')).toEqual([]);
    expect(modelCredentialEnvironmentVariables('codex-cli')).toEqual([]);
  });
});

describe('subscription transports', () => {
  const claudeCode = { provider: 'claude-code', name: 'opus' } as const;

  it('stays inert until the host opts in, so no CLI is ever spawned by default', () => {
    expect(modelFromEnvironment(claudeCode, {})).toBeInstanceOf(UnconfiguredModelProvider);
    expect(isModelConfigured('claude-code', {})).toBe(false);
    expect(
      modelFromEnvironment({ provider: 'codex-cli', name: 'gpt-5.2-codex' }, {}),
    ).toBeInstanceOf(UnconfiguredModelProvider);
  });

  it('ignores an API key: the flag is the only thing that enables the transport', () => {
    expect(
      modelFromEnvironment(claudeCode, { ANTHROPIC_API_KEY: 'test-key-value' }),
    ).toBeInstanceOf(UnconfiguredModelProvider);
  });

  it('selects the transport once the flag is exactly true', () => {
    const configured = modelFromEnvironment(claudeCode, {
      CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true',
    });
    // Every subscription transport is wrapped so a spent usage window can be waited out; the
    // wrapped transport is the one the selection named.
    expect(configured).toBeInstanceOf(ResumingSubscriptionProvider);
    expect(configured).toMatchObject({ inner: { provider: 'claude-code', model: 'opus' } });
    expect(
      isModelConfigured('claude-code', { CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true' }),
    ).toBe(true);
  });

  it('reaches the composition root spawner through the full chain, not just the factory', async () => {
    // `modelFromEnvironment` is what a composition root actually calls; the deeper unit test on
    // `subscriptionLanguageModel` in subscription.test.ts proves the spawner is honored once
    // wired, this proves the third parameter here actually reaches it end to end.
    let spawnedCommand: string | undefined;
    const spawnClaudeCodeProcess: ClaudeCodeProcessSpawner = (options) => {
      spawnedCommand = options.command;
      return spawn(options.command, options.args, { stdio: 'pipe' });
    };
    const configured = modelFromEnvironment(
      claudeCode,
      {
        CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true',
        CODE_ZERO_CLAUDE_CODE_PATH: process.execPath,
      },
      spawnClaudeCodeProcess,
    );
    // Node itself is not the Claude Code CLI, so the call fails once the protocol mismatches —
    // after the spawn already happened, which is the only thing this test needs to prove.
    await expect(configured.decide(context())).rejects.toThrow(CLI_EXITED);
    expect(spawnedCommand).toBe(process.execPath);
  });

  it('wraps the transport when an operator configured a credentialed fallback', () => {
    expect(
      modelFromEnvironment(claudeCode, {
        CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true',
        CODE_ZERO_MODEL_FALLBACK_PROVIDER: 'anthropic',
        CODE_ZERO_MODEL_FALLBACK_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_API_KEY: 'test-key-value',
      }),
    ).toBeInstanceOf(FallbackModelProvider);
  });

  it('keeps the actionable CLI error when the fallback has no credential of its own', () => {
    expect(
      modelFromEnvironment(claudeCode, {
        CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true',
        CODE_ZERO_MODEL_FALLBACK_PROVIDER: 'anthropic',
        CODE_ZERO_MODEL_FALLBACK_MODEL: 'claude-sonnet-4-5',
      }),
    ).toBeInstanceOf(ResumingSubscriptionProvider);
  });

  it('preserves a configured fallback when a composition root refuses the transport', () => {
    // Reproduces the finding this closes: a composition root that has decided this run cannot use
    // claude-code (a RunnerPool lease its CLI process cannot be routed through, for one) must not
    // report the transport as never configured — that would skip fallback selection entirely and
    // turn a configured CODE_ZERO_MODEL_FALLBACK_PROVIDER into a run that fails outright instead
    // of degrading to it. The enable flag stays on; only the refusal reason changes.
    const configured = modelFromEnvironment(
      claudeCode,
      {
        CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true',
        CODE_ZERO_MODEL_FALLBACK_PROVIDER: 'anthropic',
        CODE_ZERO_MODEL_FALLBACK_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_API_KEY: 'test-key-value',
      },
      undefined,
      'A RunnerPool lease is active for this task.',
    );
    expect(configured).toBeInstanceOf(FallbackModelProvider);
  });

  it('refuses the transport with the supplied reason when no fallback is configured', async () => {
    const configured = modelFromEnvironment(
      claudeCode,
      { CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true' },
      undefined,
      'A RunnerPool lease is active for this task.',
    );
    expect(configured).toBeInstanceOf(ResumingSubscriptionProvider);
    await expect(configured.decide(context())).rejects.toThrow(
      'A RunnerPool lease is active for this task.',
    );
  });

  it('rejects a wait budget that is not a duration', () => {
    for (const value of ['soon', '-1'])
      expect(() =>
        modelFromEnvironment(claudeCode, {
          CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true',
          CODE_ZERO_SUBSCRIPTION_LIMIT_WAIT_MS: value,
        }),
      ).toThrow(NON_DURATION_WAIT);
  });

  it('rejects a fallback that cannot degrade anything', () => {
    const base = {
      CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER: 'true',
      CODE_ZERO_MODEL_FALLBACK_MODEL: 'gpt-5',
    };
    expect(() => modelFromEnvironment(claudeCode, base)).toThrow(INCOMPLETE_FALLBACK);
    expect(() =>
      modelFromEnvironment(claudeCode, {
        ...base,
        CODE_ZERO_MODEL_FALLBACK_PROVIDER: 'codex-cli',
      }),
    ).toThrow(SUBSCRIPTION_FALLBACK);
    expect(() =>
      modelFromEnvironment(claudeCode, {
        ...base,
        CODE_ZERO_MODEL_FALLBACK_PROVIDER: 'not-a-provider',
      }),
    ).toThrow(UNKNOWN_FALLBACK);
  });
});

describe('FallbackModelProvider', () => {
  const succeeding: ModelProvider = { decide: async () => decision };

  it('degrades only when the host cannot reach the primary transport', async () => {
    const unreachable: ModelProvider = {
      decide: async () => {
        throw new SubscriptionProviderUnavailableError('claude-code', 'run `claude login`');
      },
    };
    await expect(
      new FallbackModelProvider(unreachable, succeeding).decide(context()),
    ).resolves.toMatchObject({ finding: { title: 'Null return' } });
  });

  it('never swaps transports because it disliked the answer', async () => {
    const failing: ModelProvider = {
      decide: async () => {
        throw new Error('Model returned an invalid decision');
      },
    };
    await expect(new FallbackModelProvider(failing, succeeding).decide(context())).rejects.toThrow(
      'Model returned an invalid decision',
    );
  });
});

describe('isAgentDecision', () => {
  it('accepts a well-formed decision', () => {
    expect(isAgentDecision(decision)).toBe(true);
  });

  it('rejects malformed model output', () => {
    for (const candidate of [
      null,
      'text',
      { finding: decision.finding, plan: 'not a list', changes: [] },
      { finding: { ...decision.finding, severity: 'catastrophic' }, plan: [], changes: [] },
      { finding: { ...decision.finding, confidence: Number.NaN }, plan: [], changes: [] },
      { finding: decision.finding, plan: [], changes: [{ path: 'a.ts' }] },
      { ...decision, changeRisk: 'anything-goes' },
    ])
      expect(isAgentDecision(candidate)).toBe(false);
  });
});

describe('ResumingSubscriptionProvider', () => {
  const START = Date.parse('2026-08-15T12:00:00.000Z');

  /**
   * A transport that reports a spent window once per entry in `resets`, then succeeds.
   *
   * The clock and the sleep are injected so the suite asserts on the waits that were requested
   * rather than on time actually passing. `forever` keeps reporting the last window, standing in
   * for a transport whose reset instant never actually arrives.
   */
  function spentWindow(resets: readonly (Date | undefined)[], forever = false) {
    const slept: number[] = [];
    let clock = START;
    let calls = 0;
    const inner: ModelProvider = {
      decide: async () => {
        calls += 1;
        const spent = forever ? resets.at(-1) : resets[calls - 1];
        if (calls <= resets.length || forever)
          throw new SubscriptionLimitReachedError('claude-code', 'limit reached', spent);
        return decision;
      },
    };
    return {
      inner,
      slept,
      calls: () => calls,
      now: () => clock,
      sleep: async (ms: number) => {
        slept.push(ms);
        clock += ms;
      },
    };
  }

  it('waits for the window to reopen and resumes the interrupted session', async () => {
    const harness = spentWindow([new Date(START + 600_000)]);
    const session = createSubscriptionSession();
    session.id = 'session-abc';
    const provider = new ResumingSubscriptionProvider(harness.inner, session, {
      maxWaitMs: 3_600_000,
      now: harness.now,
      sleep: harness.sleep,
    });

    await expect(provider.decide(context())).resolves.toMatchObject({
      finding: { title: 'Null return' },
    });
    // Ten minutes plus the grace margin, so the retry cannot race the reset instant.
    expect(harness.slept).toEqual([605_000]);
    expect(session.resume).toBe('session-abc');
  });

  it('reissues rather than resuming when the transport never reported a session', async () => {
    const harness = spentWindow([new Date(START + 60_000)]);
    const session = createSubscriptionSession();
    const provider = new ResumingSubscriptionProvider(harness.inner, session, {
      maxWaitMs: 3_600_000,
      now: harness.now,
      sleep: harness.sleep,
    });

    await expect(provider.decide(context())).resolves.toBeDefined();
    expect(session.resume).toBeUndefined();
  });

  it('refuses to wait on a reset it was never told about', async () => {
    const harness = spentWindow([undefined]);
    const provider = new ResumingSubscriptionProvider(harness.inner, createSubscriptionSession(), {
      maxWaitMs: 3_600_000,
      now: harness.now,
      sleep: harness.sleep,
    });

    await expect(provider.decide(context())).rejects.toBeInstanceOf(SubscriptionLimitReachedError);
    expect(harness.slept).toEqual([]);
  });

  it('propagates a reset further out than this deployment agreed to wait', async () => {
    const harness = spentWindow([new Date(START + 7_200_000)]);
    const provider = new ResumingSubscriptionProvider(harness.inner, createSubscriptionSession(), {
      maxWaitMs: 3_600_000,
      now: harness.now,
      sleep: harness.sleep,
    });

    // The error keeps its reset instant so a fallback still gets its turn and an operator still
    // learns when the window reopens.
    await expect(provider.decide(context())).rejects.toMatchObject({
      resetsAt: new Date(START + 7_200_000),
    });
    expect(harness.slept).toEqual([]);
  });

  it('never waits at all when the deployment set the budget to zero', async () => {
    const harness = spentWindow([new Date(START + 1_000)]);
    const provider = new ResumingSubscriptionProvider(harness.inner, createSubscriptionSession(), {
      maxWaitMs: 0,
      now: harness.now,
      sleep: harness.sleep,
    });

    await expect(provider.decide(context())).rejects.toBeInstanceOf(SubscriptionLimitReachedError);
    expect(harness.calls()).toBe(1);
  });

  it('spends the budget across successive windows instead of restarting it', async () => {
    const harness = spentWindow([new Date(START + 600_000), new Date(START + 1_500_000)]);
    const provider = new ResumingSubscriptionProvider(harness.inner, createSubscriptionSession(), {
      maxWaitMs: 3_600_000,
      now: harness.now,
      sleep: harness.sleep,
    });

    // The injected clock advances with each sleep, so the second window's wait is measured from
    // when the first one ended — the budget shrinks, it does not reset. Ten minutes then the
    // fifteen-minute mark, which is only nine more minutes away by the time it is reached.
    await expect(provider.decide(context())).resolves.toBeDefined();
    expect(harness.slept).toEqual([605_000, 900_000]);
  });

  it('stops retrying a transport that keeps reporting a reset that never arrives', async () => {
    const harness = spentWindow([new Date(START + 1_000)], true);
    const provider = new ResumingSubscriptionProvider(harness.inner, createSubscriptionSession(), {
      maxWaitMs: 3_600_000,
      now: harness.now,
      sleep: harness.sleep,
    });

    await expect(provider.decide(context())).rejects.toBeInstanceOf(SubscriptionLimitReachedError);
    expect(harness.calls()).toBe(3);
  });

  it('leaves every other failure alone, including the ones it cannot wait out', async () => {
    for (const error of [
      new SubscriptionProviderUnavailableError('claude-code', 'run `claude login`'),
      new Error('Model returned an invalid decision'),
    ]) {
      const inner: ModelProvider = {
        decide: async () => {
          throw error;
        },
      };
      const provider = new ResumingSubscriptionProvider(inner, createSubscriptionSession(), {
        maxWaitMs: 3_600_000,
        sleep: async () => {
          throw new Error('must not wait');
        },
      });
      await expect(provider.decide(context())).rejects.toBe(error);
    }
  });
});
