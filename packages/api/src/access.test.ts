import { describe, expect, it } from 'vitest';

import {
  accessFromEnvironment,
  authenticate,
  controlPlaneOriginsFromEnvironment,
  mayTargetRepository,
  sessionPrincipal,
  type ControlPlaneAccess,
} from './access.js';

const TOKEN_FORMAT_ERROR = /name:token/;
const MODE_FORMAT_ERROR = /name:mode\|mode/;
const UNKNOWN_MODE_ERROR = /unknown mode/;
const UNKNOWN_PRINCIPAL_ERROR = /unknown principal/;

function access(overrides: Partial<ControlPlaneAccess> = {}): ControlPlaneAccess {
  return {
    principals: new Map([
      [
        'token-value',
        {
          name: 'release-manager',
          kind: 'token' as const,
          modes: ['observe', 'suggest'] as const,
          admin: false,
        },
      ],
    ]),
    repositories: ['/srv/checkout'],
    ...overrides,
  };
}

describe('accessFromEnvironment', () => {
  it('fails closed when nothing is configured', () => {
    expect(accessFromEnvironment(undefined, undefined)).toBeUndefined();
    expect(accessFromEnvironment('', '')).toBeUndefined();
    expect(accessFromEnvironment(' , ', '  ')).toBeUndefined();
  });

  it('accepts an allow-list without tokens, for a deployment that only has sessions', () => {
    // The two answer different questions: tokens say who a machine caller is, the allow-list says
    // what any authenticated caller may target — including a person signed into the dashboard.
    const parsed = accessFromEnvironment(undefined, '/srv/checkout');

    expect(parsed?.repositories).toEqual(['/srv/checkout']);
    // No token authenticates anything, which is what keeps this still closed to machine callers.
    expect(parsed?.principals.size).toBe(0);
  });

  it('parses name:token pairs and the repository allow-list', () => {
    const parsed = accessFromEnvironment('release-manager:tok1, ci:tok2', '/srv/app, ./checkout');
    expect(parsed?.principals.get('tok1')?.name).toBe('release-manager');
    expect(parsed?.principals.get('tok2')?.name).toBe('ci');
    expect(parsed?.repositories).toEqual(['/srv/app', './checkout']);
  });

  it('keeps tokens containing separators intact after the first colon', () => {
    const parsed = accessFromEnvironment('ops:v1:secret');
    expect(parsed?.principals.get('v1:secret')?.name).toBe('ops');
  });

  it('refuses malformed entries rather than silently dropping them', () => {
    expect(() => accessFromEnvironment('missing-separator')).toThrow(TOKEN_FORMAT_ERROR);
    expect(() => accessFromEnvironment(':token-only')).toThrow(TOKEN_FORMAT_ERROR);
    expect(() => accessFromEnvironment('name-only:')).toThrow(TOKEN_FORMAT_ERROR);
  });

  it('defaults to an empty repository allow-list', () => {
    expect(accessFromEnvironment('ops:tok', undefined)?.repositories).toEqual([]);
  });

  it('grants only the non-writable modes without an explicit mode entry', () => {
    const parsed = accessFromEnvironment('ops:tok', undefined, undefined);
    expect(parsed?.principals.get('tok')?.modes).toEqual(['observe', 'suggest']);
  });

  it('parses per-principal mode grants', () => {
    const parsed = accessFromEnvironment(
      'release-manager:tok1, ci:tok2',
      undefined,
      'release-manager:observe|fix|autonomous',
    );
    expect(parsed?.principals.get('tok1')?.modes).toEqual(['observe', 'fix', 'autonomous']);
    expect(parsed?.principals.get('tok2')?.modes).toEqual(['observe', 'suggest']);
  });

  it('refuses unknown modes rather than silently granting or dropping them', () => {
    expect(() => accessFromEnvironment('ops:tok', undefined, 'ops:yolo')).toThrow(
      UNKNOWN_MODE_ERROR,
    );
  });

  it('refuses mode grants for principals that hold no token', () => {
    expect(() => accessFromEnvironment('ops:tok', undefined, 'ghost:fix')).toThrow(
      UNKNOWN_PRINCIPAL_ERROR,
    );
  });

  it('refuses malformed mode entries', () => {
    expect(() => accessFromEnvironment('ops:tok', undefined, 'ops')).toThrow(MODE_FORMAT_ERROR);
    expect(() => accessFromEnvironment('ops:tok', undefined, 'ops:')).toThrow(MODE_FORMAT_ERROR);
    expect(() => accessFromEnvironment('ops:tok', undefined, ':fix')).toThrow(MODE_FORMAT_ERROR);
    expect(() => accessFromEnvironment('ops:tok', undefined, 'ops:|')).toThrow(MODE_FORMAT_ERROR);
  });
});

describe('authenticate', () => {
  it('resolves the principal for a valid bearer token', () => {
    expect(authenticate('Bearer token-value', access())).toEqual({
      name: 'release-manager',
      kind: 'token',
      admin: false,
      modes: ['observe', 'suggest'],
    });
  });

  it('rejects missing, malformed, and unknown credentials', () => {
    expect(authenticate(undefined, access())).toBeUndefined();
    expect(authenticate('token-value', access())).toBeUndefined();
    expect(authenticate('Basic token-value', access())).toBeUndefined();
    expect(authenticate('Bearer wrong-token', access())).toBeUndefined();
    expect(authenticate('Bearer token-valu', access())).toBeUndefined();
  });

  it('fails closed when no access policy is configured', () => {
    expect(authenticate('Bearer token-value', undefined)).toBeUndefined();
  });
});

describe('controlPlaneOriginsFromEnvironment', () => {
  it('defaults to no trusted origins', () => {
    expect(controlPlaneOriginsFromEnvironment(undefined)).toEqual([]);
    expect(controlPlaneOriginsFromEnvironment('')).toEqual([]);
    expect(controlPlaneOriginsFromEnvironment(' , ')).toEqual([]);
  });

  it('parses a comma-separated origin allow-list', () => {
    expect(
      controlPlaneOriginsFromEnvironment('https://dashboard.example, https://ops.example'),
    ).toEqual(['https://dashboard.example', 'https://ops.example']);
  });
});

describe('mayTargetRepository', () => {
  it('authorizes only allow-listed repository paths', () => {
    expect(mayTargetRepository('/srv/checkout', access())).toBe(true);
    expect(mayTargetRepository('/srv/other', access())).toBe(false);
  });

  it('compares resolved paths so traversal cannot dodge the allow-list', () => {
    expect(mayTargetRepository('/srv/checkout/../checkout', access())).toBe(true);
    expect(mayTargetRepository('/srv/checkout/../other', access())).toBe(false);
  });

  it('fails closed without a policy or with an empty allow-list', () => {
    expect(mayTargetRepository('/srv/checkout', undefined)).toBe(false);
    expect(mayTargetRepository('/srv/checkout', access({ repositories: [] }))).toBe(false);
  });
});

describe('sessionPrincipal', () => {
  it('grants an administrator every execution mode', () => {
    expect(sessionPrincipal('ops@example.test', true)).toEqual({
      name: 'ops@example.test',
      kind: 'session',
      admin: true,
      modes: ['observe', 'suggest', 'fix', 'autonomous'],
    });
  });

  it('holds every other signed-in user to the non-writable modes', () => {
    expect(sessionPrincipal('dev@example.test', false)).toEqual({
      name: 'dev@example.test',
      kind: 'session',
      admin: false,
      modes: ['observe', 'suggest'],
    });
  });
});
