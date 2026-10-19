import type { OrganizationSettingsView } from '@code-zero/api';
import type { DeploymentSettings } from '@code-zero/config';
import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';

import {
  classifySettingsError,
  DEFAULT_SETTINGS,
  formFromSettings,
  formFromView,
  issuesFromError,
  organizationFieldIssues,
  organizationFormFromView,
  organizationInputFromForm,
  selectableModes,
  settingsFieldIssues,
  settingsInputFromForm,
  type SelfHostedSettingsView,
} from './form.js';

const SETTINGS: DeploymentSettings = {
  execution: {
    maxConcurrentTasks: 8,
    commandTimeoutMinutes: 20,
    allowedModes: ['observe', 'suggest'],
    maxNetwork: 'restricted',
  },
  model: { provider: 'anthropic', name: 'claude-sonnet' },
  runner: { isolation: 'container', engine: 'podman', image: 'ghcr.io/acme/runner:1' },
};

const BOUNDS = {
  maxConcurrentTasks: { minimum: 1, maximum: 64 },
  commandTimeoutMinutes: { minimum: 1, maximum: 1440 },
} as const;

function selfHosted(state: SelfHostedSettingsView['state']): SelfHostedSettingsView {
  return {
    edition: 'self-hosted',
    source: 'dashboard',
    editable: true,
    filePath: null,
    state,
    services: [],
    bounds: BOUNDS,
  };
}

function organization(limits: OrganizationSettingsView['limits']): OrganizationSettingsView {
  return { id: 'org_1', role: 'owner', editable: true, limits, invalid: false, effective: null };
}

describe('the deployment settings form', () => {
  it('sends back exactly the settings it was filled from', () => {
    const result = settingsInputFromForm(formFromSettings(SETTINGS));

    expect(result).toEqual({
      ok: true,
      input: {
        execution: {
          maxConcurrentTasks: 8,
          commandTimeoutMinutes: 20,
          allowedModes: ['observe', 'suggest'],
          maxNetwork: 'restricted',
        },
        model: { provider: 'anthropic', name: 'claude-sonnet' },
        runner: { isolation: 'container', engine: 'podman', image: 'ghcr.io/acme/runner:1' },
      },
    });
  });

  it('sends no model and no runner when each repository chooses its own', () => {
    const form = formFromSettings(SETTINGS);
    form.modelSource = 'repository';
    form.runnerSource = 'repository';

    const result = settingsInputFromForm(form);

    expect(result.ok && result.input.model).toBeNull();
    expect(result.ok && result.input.runner).toBeNull();
  });

  it('sends modes in the canonical order, whatever order they were ticked in', () => {
    const form = formFromSettings(SETTINGS);
    form.allowedModes = ['fix', 'observe', 'suggest'];

    const result = settingsInputFromForm(form);

    expect(result.ok && result.input.execution.allowedModes).toEqual(['observe', 'suggest', 'fix']);
  });

  it('trims the model name and the image before sending them', () => {
    const form = formFromSettings(SETTINGS);
    form.modelName = '  gpt-5 ';
    form.runnerImage = ' ghcr.io/acme/runner:2\n';

    const result = settingsInputFromForm(form);

    expect(result.ok && result.input.model?.name).toBe('gpt-5');
    expect(result.ok && result.input.runner?.image).toBe('ghcr.io/acme/runner:2');
  });

  it('accepts the numbers Vue casts a number input to, as well as text', () => {
    const form = formFromSettings(SETTINGS);
    form.maxConcurrentTasks = 12;
    form.commandTimeoutMinutes = '45';

    const result = settingsInputFromForm(form);

    expect(result.ok && result.input.execution.maxConcurrentTasks).toBe(12);
    expect(result.ok && result.input.execution.commandTimeoutMinutes).toBe(45);
  });

  it('refuses to send an emptied number, naming the field', () => {
    const form = formFromSettings(SETTINGS);
    form.commandTimeoutMinutes = '';

    expect(settingsInputFromForm(form)).toEqual({
      ok: false,
      issues: { commandTimeoutMinutes: [{ key: 'dashboard.settings.form.numberRequired' }] },
    });
  });

  it('leaves the bounds to the server: an out-of-range value is sent as typed', () => {
    const form = formFromSettings(SETTINGS);
    form.maxConcurrentTasks = '9000';

    const result = settingsInputFromForm(form);

    expect(result.ok && result.input.execution.maxConcurrentTasks).toBe(9000);
  });

  it("starts from the parser's defaults when the stored settings are invalid", () => {
    const form = formFromView(
      selfHosted({ ok: false, issues: [{ path: '$', message: 'Broken.' }] }),
    );

    expect(form).toEqual(formFromSettings(DEFAULT_SETTINGS));
  });
});

describe('server issues', () => {
  it('lands each issue on the control its path names', () => {
    const issues = settingsFieldIssues([
      {
        path: '$.execution.command_timeout_minutes',
        message: 'Expected an integer from 1 to 1440.',
      },
      { path: '$.execution.allowed_modes', message: 'Expected a list that includes observe.' },
      { path: '$.model.name', message: 'Looks like a credential.' },
      { path: '$.model', message: 'A cloud deployment must configure the model.' },
      { path: '$.runner.image', message: 'Expected a container image reference.' },
    ]);

    expect(issues).toEqual({
      commandTimeoutMinutes: [{ text: 'Expected an integer from 1 to 1440.' }],
      allowedModes: [{ text: 'Expected a list that includes observe.' }],
      modelName: [{ text: 'Looks like a credential.' }],
      modelSource: [{ text: 'A cloud deployment must configure the model.' }],
      runnerImage: [{ text: 'Expected a container image reference.' }],
    });
  });

  it('keeps an issue no control owns at the form level rather than dropping it', () => {
    const issues = settingsFieldIssues([
      { path: '$.execution.max_concurrent_tasks_typo', message: 'Unknown setting.' },
      { path: '$', message: 'Expected an object.' },
    ]);

    expect(issues).toEqual({
      form: [{ text: 'Unknown setting.' }, { text: 'Expected an object.' }],
    });
  });

  it("reads the organization limits' paths from the limits document's own root", () => {
    expect(
      organizationFieldIssues([
        { path: '$.command_timeout_minutes', message: 'The plan allows at most 60.' },
        { path: '$.allowed_modes', message: 'The plan does not allow fix.' },
      ]),
    ).toEqual({
      commandTimeoutMinutes: [{ text: 'The plan allows at most 60.' }],
      allowedModes: [{ text: 'The plan does not allow fix.' }],
    });
  });

  it("reads issues out of a BAD_REQUEST's data, skipping entries of any other shape", () => {
    const refusal = new ORPCError('BAD_REQUEST', {
      data: {
        issues: [
          { path: '$.model.name', message: 'Expected a model name.' },
          { message: 'Input validation failed', path: ['execution', 0] },
          'not an issue',
        ],
      },
    });

    expect(issuesFromError(refusal)).toEqual([
      { path: '$.model.name', message: 'Expected a model name.' },
      { path: '$', message: 'Input validation failed' },
    ]);
  });

  it('finds no value issues in a refusal that was not about the values', () => {
    expect(issuesFromError(new ORPCError('FORBIDDEN'))).toBeNull();
    expect(issuesFromError(new Error('network'))).toBeNull();
  });

  it('classifies a failure by its code, never by its message', () => {
    expect(classifySettingsError(new ORPCError('FORBIDDEN', { message: 'anything' }))).toBe(
      'forbidden',
    );
    expect(classifySettingsError(new ORPCError('UNAUTHORIZED'))).toBe('unauthorized');
    expect(classifySettingsError(new ORPCError('NOT_IMPLEMENTED'))).toBe('unavailable');
    expect(classifySettingsError(new ORPCError('BAD_REQUEST'))).toBe('invalid');
    expect(classifySettingsError(new ORPCError('PRECONDITION_FAILED'))).toBe('precondition');
    expect(classifySettingsError(new ORPCError('INTERNAL_SERVER_ERROR'))).toBe('generic');
    expect(classifySettingsError(new TypeError('fetch failed'))).toBe('generic');
  });
});

describe('the organization limits form', () => {
  it('sends null for every limit left to the plan', () => {
    const form = organizationFormFromView(
      organization({ maxConcurrentTasks: null, commandTimeoutMinutes: null, allowedModes: null }),
      null,
    );

    expect(organizationInputFromForm(form)).toEqual({
      ok: true,
      input: { maxConcurrentTasks: null, commandTimeoutMinutes: null, allowedModes: null },
    });
  });

  it('sends the limits an organization chose, modes in the canonical order', () => {
    const form = organizationFormFromView(
      organization({ maxConcurrentTasks: 2, commandTimeoutMinutes: 10, allowedModes: ['observe'] }),
      null,
    );
    form.allowedModes = ['suggest', 'observe'];

    expect(organizationInputFromForm(form)).toEqual({
      ok: true,
      input: {
        maxConcurrentTasks: 2,
        commandTimeoutMinutes: 10,
        allowedModes: ['observe', 'suggest'],
      },
    });
  });

  it('hands the modes back to the plan when they are no longer restricted', () => {
    const form = organizationFormFromView(
      organization({
        maxConcurrentTasks: null,
        commandTimeoutMinutes: null,
        allowedModes: ['observe'],
      }),
      null,
    );
    form.restrictModes = false;

    const result = organizationInputFromForm(form);

    expect(result.ok && result.input.allowedModes).toBeNull();
  });

  it('never sends a mode the plan does not allow, since the form shows no box for one', () => {
    const plan = {
      maxConcurrentTasks: 6,
      commandTimeoutMinutes: 20,
      allowedModes: ['observe', 'suggest', 'fix'],
      maxNetwork: 'restricted',
    } as const;
    const form = organizationFormFromView(
      organization({ maxConcurrentTasks: null, commandTimeoutMinutes: null, allowedModes: null }),
      plan,
    );

    // Restrict, then untick fix: what is left is what the reader sees ticked, and nothing else.
    form.restrictModes = true;
    form.allowedModes = form.allowedModes.filter((mode) => mode !== 'fix');

    const result = organizationInputFromForm(form);
    expect(result.ok && result.input.allowedModes).toEqual(['observe', 'suggest']);
  });

  it('drops a stored mode the plan has since stopped allowing from the draft', () => {
    const form = organizationFormFromView(
      organization({
        maxConcurrentTasks: null,
        commandTimeoutMinutes: null,
        allowedModes: ['observe', 'autonomous'],
      }),
      {
        maxConcurrentTasks: 6,
        commandTimeoutMinutes: 20,
        allowedModes: ['observe'],
        maxNetwork: 'none',
      },
    );

    expect(form.allowedModes).toEqual(['observe']);
  });

  it("offers only the plan's modes to narrow", () => {
    expect(
      selectableModes({
        maxConcurrentTasks: 4,
        commandTimeoutMinutes: 30,
        allowedModes: ['observe', 'fix'],
        maxNetwork: 'none',
      }),
    ).toEqual(['observe', 'fix']);
  });
});
