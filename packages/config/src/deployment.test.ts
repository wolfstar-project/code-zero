import { describe, expect, it } from 'vitest';

import {
  defaultDeploymentConfig,
  describeDeploymentConfigIssues,
  parseDeploymentConfig,
} from './deployment.js';

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
