import { defaultDeploymentSettings } from '@code-zero/config';
import { describe, expect, it } from 'vitest';

import { deploymentServices, runExecution, scheduleLimits } from './settings.js';

const connections = { database: true, mail: false, hostedSandbox: false };

describe('deploymentServices', () => {
  it('reports whether the named model has a credential, never the credential', () => {
    const secret = 'sk-ant-0123456789abcdefghij';
    const services = deploymentServices(
      { ...defaultDeploymentSettings, model: { provider: 'anthropic', name: 'claude-sonnet-4-5' } },
      connections,
      { ANTHROPIC_API_KEY: secret },
    );

    expect(services).toContainEqual({ service: 'model', configured: true });
    expect(JSON.stringify(services)).not.toContain(secret);
  });

  it('says nothing about the model while each repository chooses its own', () => {
    const services = deploymentServices(defaultDeploymentSettings, connections, {});

    expect(services.map((status) => status.service)).not.toContain('model');
  });

  it('counts a hosted sandbox provider as the sandbox without a container image', () => {
    expect(
      deploymentServices(defaultDeploymentSettings, { ...connections, hostedSandbox: true }, {}),
    ).toContainEqual({ service: 'sandbox', configured: true });
  });

  it('reports no sandbox when neither a container nor a hosted provider is set up', () => {
    expect(deploymentServices(defaultDeploymentSettings, connections, {})).toContainEqual({
      service: 'sandbox',
      configured: false,
    });
  });
});

describe('scheduleLimits', () => {
  it("bounds an organization's runs by its own lower limit and everyone by the plan's", () => {
    expect(
      scheduleLimits({
        settings: defaultDeploymentSettings,
        organization: {
          id: 'org-a',
          limits: { maxConcurrentTasks: 1, commandTimeoutMinutes: null, allowedModes: null },
        },
      }),
    ).toEqual({ maxConcurrent: 4, group: { key: 'org-a', maxConcurrent: 1 } });
  });

  it('leaves work started for the deployment itself to the plan alone', () => {
    expect(scheduleLimits({ settings: defaultDeploymentSettings })).toEqual({ maxConcurrent: 4 });
  });
});

describe('runExecution', () => {
  it('never lets an organization widen what the plan allows', () => {
    expect(
      runExecution({
        settings: {
          ...defaultDeploymentSettings,
          execution: { ...defaultDeploymentSettings.execution, allowedModes: ['observe'] },
        },
        organization: {
          id: 'org-a',
          limits: {
            maxConcurrentTasks: 64,
            commandTimeoutMinutes: null,
            allowedModes: ['observe', 'autonomous'],
          },
        },
      }),
    ).toMatchObject({ maxConcurrentTasks: 4, allowedModes: ['observe'] });
  });
});
