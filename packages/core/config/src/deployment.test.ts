import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultDeploymentConfig,
  describeDeploymentConfigIssues,
  loadDeploymentFile,
  locateDeploymentConfig,
  parseDeploymentConfig,
  parseDeploymentFile,
} from './deployment.js';
import { defaultDeploymentSettings } from './settings.js';

describe('parseDeploymentConfig', () => {
  it('reads the whole file', () => {
    const { config, issues } = parseDeploymentConfig(`
control_plane:
  origins:
    - https://ops.example.com
  modes:
    ci: [observe, suggest]
    release: [observe, suggest, fix, autonomous]
poll:
  interval_seconds: 120
`);

    expect(issues).toEqual([]);
    expect(config.controlPlane.origins).toEqual(['https://ops.example.com']);
    expect(config.controlPlane.modes.get('ci')).toEqual(['observe', 'suggest']);
    expect(config.controlPlane.modes.get('release')).toEqual([
      'observe',
      'suggest',
      'fix',
      'autonomous',
    ]);
    expect(config.poll.intervalSeconds).toBe(120);
  });

  it.each(['', '   ', '# only a comment'])(
    'treats %j as a deployment that has configured nothing yet',
    (text) => {
      expect(parseDeploymentConfig(text)).toEqual({
        config: defaultDeploymentConfig,
        issues: [],
      });
    },
  );

  it('defaults every section a file leaves out', () => {
    const { config, issues } = parseDeploymentConfig('poll:\n  interval_seconds: 30\n');

    expect(issues).toEqual([]);
    // The unstated half is the closed one: no origin may read cross-origin, no token is widened.
    expect(config.controlPlane.origins).toEqual([]);
    expect(config.controlPlane.modes.size).toBe(0);
    expect(config.poll.intervalSeconds).toBe(30);
  });

  it('names the field and the line-level path for each mistake, not just the first', () => {
    const { issues } = parseDeploymentConfig(`
control_plane:
  origins: "https://ops.example.com"
poll:
  interval_seconds: 5
`);

    expect(issues).toEqual([
      { path: '$.control_plane.origins', message: 'Expected a list of non-empty strings.' },
      { path: '$.poll.interval_seconds', message: 'Expected an integer from 15 to 3600.' },
    ]);
  });

  it('keeps the default for a field it refused, rather than a value nothing validated', () => {
    const { config } = parseDeploymentConfig('poll:\n  interval_seconds: 99999\n');

    expect(config.poll.intervalSeconds).toBe(defaultDeploymentConfig.poll.intervalSeconds);
  });

  it('refuses an unknown execution mode instead of quietly narrowing the grant', () => {
    const { config, issues } = parseDeploymentConfig(
      'control_plane:\n  modes:\n    ci: [observe, teleport]\n',
    );

    expect(issues).toEqual([
      { path: '$.control_plane.modes.ci', message: 'Unknown execution mode: teleport' },
    ]);
    // The whole grant is refused rather than narrowed to its valid half, but the principal still
    // resolves to an empty grant rather than none at all: a missing entry reads downstream as "no
    // grant configured" and widens to the non-writable defaults, which would grant `ci` more than
    // the mistake in its config ever asked for.
    expect(config.controlPlane.modes.get('ci')).toEqual([]);
  });

  it('refuses an empty grant, which reads as a mistake rather than as "no modes"', () => {
    const { issues } = parseDeploymentConfig('control_plane:\n  modes:\n    ci: []\n');

    expect(issues).toEqual([
      {
        path: '$.control_plane.modes.ci',
        message: 'Expected a non-empty list of execution modes.',
      },
    ]);
  });

  it('reports malformed YAML against the document rather than throwing at the caller', () => {
    const { config, issues } = parseDeploymentConfig('control_plane: [unclosed\n');

    expect(issues[0]?.path).toBe('$');
    expect(config).toEqual(defaultDeploymentConfig);
  });

  it('refuses a document that is not an object', () => {
    expect(parseDeploymentConfig('- one\n- two\n').issues).toEqual([
      { path: '$', message: 'Expected an object.' },
    ]);
  });

  it('refuses a section that is not an object', () => {
    expect(parseDeploymentConfig('poll: 60\n').issues).toEqual([
      { path: '$.poll', message: 'Expected an object.' },
    ]);
  });
});

describe('describeDeploymentConfigIssues', () => {
  it('renders one line per issue, so a refusal to start says everything at once', () => {
    expect(
      describeDeploymentConfigIssues([
        { path: '$.poll.interval_seconds', message: 'Expected an integer from 15 to 3600.' },
        { path: '$.control_plane.origins', message: 'Expected a list of non-empty strings.' },
      ]),
    ).toBe(
      '$.poll.interval_seconds: Expected an integer from 15 to 3600.\n' +
        '$.control_plane.origins: Expected a list of non-empty strings.',
    );
  });
});

describe('parseDeploymentFile', () => {
  it('reads the deployment configuration and the settings from one file', () => {
    const file = parseDeploymentFile(`
poll:
  interval_seconds: 30
execution:
  max_concurrent_tasks: 2
`);

    expect(file.config.poll.intervalSeconds).toBe(30);
    expect(file.declaresSettings).toBe(true);
    expect(file.settings).toEqual({
      ok: true,
      value: {
        ...defaultDeploymentSettings,
        execution: { ...defaultDeploymentSettings.execution, maxConcurrentTasks: 2 },
      },
    });
  });

  it('refuses the settings of a file it cannot parse instead of running on the defaults', () => {
    expect(parseDeploymentFile('execution: [unclosed\n').settings.ok).toBe(false);
  });

  it('keeps a mistake in the settings from disturbing the control-plane policy', () => {
    const file = parseDeploymentFile(`
control_plane:
  origins: [https://ops.example.com]
execution:
  command_timeout_minutes: 0
`);

    expect(file.config.controlPlane.origins).toEqual(['https://ops.example.com']);
    expect(file.issues).toEqual([]);
    expect(file.settings).toEqual({
      ok: false,
      issues: [
        {
          path: '$.execution.command_timeout_minutes',
          message: 'Expected an integer from 1 to 1440.',
        },
      ],
    });
  });

  it('refuses a mistyped section instead of leaving every limit at its default', () => {
    const file = parseDeploymentFile(`
poll:
  interval_seconds: 30
exection:
  allowed_modes: [observe]
`);

    expect(file.settings).toEqual({
      ok: false,
      issues: [{ path: '$.exection', message: 'Unknown section.' }],
    });
  });

  it('says when a file states no settings, so a dashboard source has nothing to ignore', () => {
    expect(parseDeploymentFile('poll:\n  interval_seconds: 30\n').declaresSettings).toBe(false);
  });
});

describe('loadDeploymentFile', () => {
  const missing = join(tmpdir(), 'code-zero-missing-deployment-file', 'nothing.yml');

  it('gives a deployment without a file the default settings', async () => {
    const file = await loadDeploymentFile(missing);

    expect(file.settings).toEqual({ ok: true, value: defaultDeploymentSettings });
  });

  it('refuses a cloud deployment whose service file is missing', async () => {
    const file = await loadDeploymentFile(missing, 'cloud');

    expect(file.settings.ok).toBe(false);
  });
});

describe('locateDeploymentConfig', () => {
  const directory = '/srv/code-zero';
  const present =
    (...names: string[]) =>
    (path: string): Promise<boolean> =>
      Promise.resolve(names.some((name) => path === join(directory, name)));

  it('reads config.yml by default', async () => {
    await expect(locateDeploymentConfig({}, directory, present('config.yml'))).resolves.toEqual({
      ok: true,
      value: { path: join(directory, 'config.yml'), legacy: false },
    });
  });

  it('still reads a deployment that kept the old file name, and says so', async () => {
    await expect(
      locateDeploymentConfig({}, directory, present('code-zero.deployment.yml')),
    ).resolves.toEqual({
      ok: true,
      value: { path: join(directory, 'code-zero.deployment.yml'), legacy: true },
    });
  });

  it('refuses to choose between two files rather than reading either', async () => {
    const located = await locateDeploymentConfig(
      {},
      directory,
      present('config.yml', 'code-zero.deployment.yml'),
    );

    expect(located.ok).toBe(false);
  });

  it('reads exactly the file CODE_ZERO_CONFIG names, whatever else is there', async () => {
    await expect(
      locateDeploymentConfig(
        { CODE_ZERO_CONFIG: 'code-zero.deployment.yml' },
        directory,
        present('config.yml', 'code-zero.deployment.yml'),
      ),
    ).resolves.toEqual({
      ok: true,
      value: { path: join(directory, 'code-zero.deployment.yml'), legacy: false },
    });
  });

  it('points a deployment with no file at config.yml, which then reads as the defaults', async () => {
    await expect(locateDeploymentConfig({}, directory, present())).resolves.toEqual({
      ok: true,
      value: { path: join(directory, 'config.yml'), legacy: false },
    });
  });
});
