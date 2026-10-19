import { describe, expect, it } from 'vitest';

import { defaultConfig, type CodeZeroConfig } from './index.js';
import {
  applyDeploymentSettings,
  defaultDeploymentSettings,
  editionFromEnvironment,
  effectiveExecution,
  organizationLimitsAbovePlan,
  parseDeploymentSettings,
  parseDeploymentSettingsText,
  parseOrganizationLimits,
  renderDeploymentSettings,
  settingsSourceFromEnvironment,
  type DeploymentSettings,
  type ExecutionSettings,
  type SandboxSettings,
} from './settings.js';

const SANDBOX: SandboxSettings = {
  isolation: 'container',
  engine: 'podman',
  image: 'ghcr.io/acme/code-zero-runner:1',
};

const CONFIGURED: DeploymentSettings = {
  execution: {
    maxConcurrentTasks: 8,
    commandTimeoutMinutes: 20,
    allowedModes: ['observe', 'suggest'],
    maxNetwork: 'none',
  },
  model: { provider: 'anthropic', name: 'claude-sonnet-4-5' },
  runner: SANDBOX,
};

const CONFIGURED_YAML = `
execution:
  max_concurrent_tasks: 8
  command_timeout_minutes: 20
  allowed_modes: [suggest, observe]
  max_network: none
model:
  provider: anthropic
  name: claude-sonnet-4-5
runner:
  isolation: container
  engine: podman
  image: ghcr.io/acme/code-zero-runner:1
`;

const PLAN: ExecutionSettings = {
  maxConcurrentTasks: 10,
  commandTimeoutMinutes: 60,
  allowedModes: ['observe', 'suggest', 'fix'],
  maxNetwork: 'restricted',
};

function repository(overrides: Partial<CodeZeroConfig> = {}): CodeZeroConfig {
  return { ...structuredClone(defaultConfig), ...overrides };
}

describe('parseDeploymentSettingsText', () => {
  it('reads every section into one document', () => {
    expect(parseDeploymentSettingsText(CONFIGURED_YAML)).toEqual({ ok: true, value: CONFIGURED });
  });

  it.each(['', '# nothing configured yet\n', 'control_plane:\n  origins: []\n'])(
    'gives %j the defaults, because it states no setting',
    (text) => {
      expect(parseDeploymentSettingsText(text)).toEqual({
        ok: true,
        value: defaultDeploymentSettings,
      });
    },
  );

  it('refuses unparseable YAML instead of falling back to the defaults', () => {
    const parsed = parseDeploymentSettingsText('execution: [unclosed\n');

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok ? parsed.issues[0]?.path : undefined).toBe('$');
  });

  it('refuses the whole document when one value is wrong, naming every mistake', () => {
    expect(
      parseDeploymentSettingsText(`
execution:
  max_concurrent_tasks: 0
  command_timeout_minutes: 99999
`),
    ).toEqual({
      ok: false,
      issues: [
        {
          path: '$.execution.max_concurrent_tasks',
          message: 'Expected an integer from 1 to 64.',
        },
        {
          path: '$.execution.command_timeout_minutes',
          message: 'Expected an integer from 1 to 1440.',
        },
      ],
    });
  });

  it('refuses a misspelled setting rather than ignoring it', () => {
    expect(parseDeploymentSettingsText('execution:\n  max_concurent_tasks: 2\n')).toEqual({
      ok: false,
      issues: [{ path: '$.execution.max_concurent_tasks', message: 'Unknown setting.' }],
    });
  });

  it('keeps observe allowed, since it is the mode every unrequested run starts in', () => {
    expect(parseDeploymentSettingsText('execution:\n  allowed_modes: [suggest]\n')).toEqual({
      ok: false,
      issues: [
        {
          path: '$.execution.allowed_modes',
          message: 'Expected a list of execution modes that includes observe.',
        },
      ],
    });
  });

  it('refuses a runner that would let repositories run on the host', () => {
    expect(parseDeploymentSettingsText('runner:\n  isolation: local\n  image: node:24\n')).toEqual({
      ok: false,
      issues: [
        {
          path: '$.runner.isolation',
          message:
            'Only container isolation can be enforced; remove the runner section to let each repository choose.',
        },
      ],
    });
  });

  it('refuses an image the container engine would read as one of its own flags', () => {
    const parsed = parseDeploymentSettingsText(
      'runner:\n  isolation: container\n  image: --privileged\n',
    );

    expect(parsed).toEqual({
      ok: false,
      issues: [{ path: '$.runner.image', message: 'Expected a container image reference.' }],
    });
  });

  it('refuses a credential pasted into a setting, so it is never stored or exported', () => {
    const parsed = parseDeploymentSettingsText(
      'model:\n  provider: openai\n  name: sk-live1234567890abcdefghij\n',
    );

    expect(parsed).toEqual({
      ok: false,
      issues: [
        {
          path: '$.model.name',
          message: 'Looks like a credential. Credentials stay in the environment.',
        },
      ],
    });
  });

  it('refuses a base URL, which would decide where the model credential is sent', () => {
    expect(
      parseDeploymentSettingsText(
        'model:\n  provider: openai\n  name: gpt-5\n  base_url: https://example.test\n',
      ),
    ).toEqual({
      ok: false,
      issues: [{ path: '$.model.base_url', message: 'Unknown setting.' }],
    });
  });
});

describe('parseDeploymentSettings for a cloud deployment', () => {
  it('requires the service to name the model its customers run on', () => {
    expect(parseDeploymentSettings({}, 'cloud')).toEqual({
      ok: false,
      issues: [{ path: '$.model', message: 'A cloud deployment must configure the model.' }],
    });
  });

  it('does not require a container engine, which a Cloudflare-hosted service does not have', () => {
    const parsed = parseDeploymentSettings(
      { model: { provider: 'anthropic', name: 'claude-sonnet-4-5' } },
      'cloud',
    );

    expect(parsed.ok).toBe(true);
  });
});

describe('renderDeploymentSettings', () => {
  it('exports YAML that reads back as the same settings', () => {
    expect(parseDeploymentSettingsText(renderDeploymentSettings(CONFIGURED))).toEqual({
      ok: true,
      value: CONFIGURED,
    });
  });

  it('never writes an environment credential into the export', () => {
    const secret = 'gateway-key-0123456789';
    const rendered = renderDeploymentSettings(
      { ...CONFIGURED, model: { provider: 'ai-gateway', name: `${secret}-model` } },
      { AI_GATEWAY_API_KEY: secret },
    );

    expect(rendered).not.toContain(secret);
  });
});

describe('editionFromEnvironment', () => {
  it('is self-hosted unless the deployment says otherwise', () => {
    expect(editionFromEnvironment({})).toEqual({ ok: true, value: 'self-hosted' });
  });

  it('does not take a Cloudflare host for the managed cloud', () => {
    expect(
      editionFromEnvironment({ CF_PAGES: '1', CLOUDFLARE_ACCOUNT_ID: 'account', CF_WORKER: 'x' }),
    ).toEqual({ ok: true, value: 'self-hosted' });
  });

  it('reads the managed cloud only from its explicit value', () => {
    expect(editionFromEnvironment({ CODE_ZERO_EDITION: 'cloud' })).toEqual({
      ok: true,
      value: 'cloud',
    });
  });

  it('refuses a value it does not know rather than guessing an edition', () => {
    expect(editionFromEnvironment({ CODE_ZERO_EDITION: 'clod' }).ok).toBe(false);
  });
});

describe('settingsSourceFromEnvironment', () => {
  it('keeps the file as the source of a deployment that never chose one', () => {
    expect(settingsSourceFromEnvironment({}, 'self-hosted')).toEqual({ ok: true, value: 'file' });
  });

  it('makes the dashboard the source only when asked', () => {
    expect(
      settingsSourceFromEnvironment({ CODE_ZERO_SETTINGS_SOURCE: 'dashboard' }, 'self-hosted'),
    ).toEqual({ ok: true, value: 'dashboard' });
  });

  it('refuses the dashboard as the source of a cloud deployment', () => {
    expect(
      settingsSourceFromEnvironment({ CODE_ZERO_SETTINGS_SOURCE: 'dashboard' }, 'cloud').ok,
    ).toBe(false);
  });

  it('refuses an unknown source rather than picking one', () => {
    expect(
      settingsSourceFromEnvironment({ CODE_ZERO_SETTINGS_SOURCE: 'database' }, 'self-hosted').ok,
    ).toBe(false);
  });
});

describe('organization limits', () => {
  it('lowers the plan where the organization chose a stricter value', () => {
    const limits = parseOrganizationLimits({
      max_concurrent_tasks: 2,
      command_timeout_minutes: null,
      allowed_modes: ['observe'],
    });

    expect(limits.ok).toBe(true);
    if (!limits.ok) return;
    expect(effectiveExecution(PLAN, limits.value)).toEqual({
      maxConcurrentTasks: 2,
      commandTimeoutMinutes: 60,
      allowedModes: ['observe'],
      maxNetwork: 'restricted',
    });
  });

  it('names every value that would exceed the plan', () => {
    expect(
      organizationLimitsAbovePlan(
        {
          maxConcurrentTasks: 11,
          commandTimeoutMinutes: 61,
          allowedModes: ['observe', 'autonomous'],
        },
        PLAN,
      ),
    ).toEqual([
      { path: '$.max_concurrent_tasks', message: 'The plan allows at most 10.' },
      { path: '$.command_timeout_minutes', message: 'The plan allows at most 60.' },
      { path: '$.allowed_modes', message: 'The plan does not allow autonomous.' },
    ]);
  });

  it('never lets a stored value exceed a plan that was lowered after it was saved', () => {
    expect(
      effectiveExecution(
        {
          maxConcurrentTasks: 3,
          commandTimeoutMinutes: 10,
          allowedModes: ['observe'],
          maxNetwork: 'none',
        },
        { maxConcurrentTasks: 8, commandTimeoutMinutes: 45, allowedModes: ['observe', 'suggest'] },
      ),
    ).toEqual({
      maxConcurrentTasks: 3,
      commandTimeoutMinutes: 10,
      allowedModes: ['observe'],
      maxNetwork: 'none',
    });
  });
});

describe('applyDeploymentSettings', () => {
  it('caps the command timeout the repository asked for', () => {
    const applied = applyDeploymentSettings(
      repository({ agent: { maxAttempts: 3, timeoutMs: 3_600_000, maxChangedFiles: 10 } }),
      { ...defaultDeploymentSettings, execution: { ...PLAN, commandTimeoutMinutes: 15 } },
    );

    expect(applied.agent.timeoutMs).toBe(900_000);
  });

  it('keeps a repository command timeout that is already shorter', () => {
    const applied = applyDeploymentSettings(
      repository({ agent: { maxAttempts: 3, timeoutMs: 60_000, maxChangedFiles: 10 } }),
      defaultDeploymentSettings,
    );

    expect(applied.agent.timeoutMs).toBe(60_000);
  });

  it('replaces the model a repository chose with the deployment model', () => {
    const applied = applyDeploymentSettings(
      repository({
        model: {
          provider: 'openai',
          name: 'gpt-5',
          inputCostPerMillionTokens: 1,
          outputCostPerMillionTokens: 2,
        },
      }),
      CONFIGURED,
    );

    expect(applied.model).toEqual({ provider: 'anthropic', name: 'claude-sonnet-4-5' });
  });

  it('forces the deployment sandbox and drops the container network the repository named', () => {
    const applied = applyDeploymentSettings(
      repository({
        runner: {
          isolation: 'local',
          engine: 'docker',
          image: 'attacker/image',
          network: 'host',
          workdir: '/workspace',
          maxOutputBytes: 200_000,
        },
      }),
      CONFIGURED,
    );

    expect(applied.runner).toEqual({
      isolation: 'container',
      engine: 'podman',
      image: 'ghcr.io/acme/code-zero-runner:1',
      workdir: '/workspace',
      maxOutputBytes: 200_000,
    });
  });

  it('holds every run to the network ceiling, with or without a deployment sandbox', () => {
    const applied = applyDeploymentSettings(repository({ permissions: { network: 'full' } }), {
      ...defaultDeploymentSettings,
      execution: { ...defaultDeploymentSettings.execution, maxNetwork: 'restricted' },
    });

    expect(applied.permissions.network).toBe('restricted');
  });

  it('lets a repository narrow the network below the deployment ceiling', () => {
    const applied = applyDeploymentSettings(
      repository({ permissions: { network: 'none' } }),
      defaultDeploymentSettings,
    );

    expect(applied.permissions.network).toBe('none');
  });

  it('leaves isolation and model to the repository when the deployment names neither', () => {
    const original = repository();
    const applied = applyDeploymentSettings(original, defaultDeploymentSettings);

    expect(applied.runner).toEqual(original.runner);
    expect(applied.model).toEqual(original.model);
  });

  it('applies the organization command timeout rather than the plan when it is stricter', () => {
    const applied = applyDeploymentSettings(repository(), CONFIGURED, {
      ...CONFIGURED.execution,
      commandTimeoutMinutes: 5,
    });

    expect(applied.agent.timeoutMs).toBe(300_000);
  });
});
