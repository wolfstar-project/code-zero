import { describe, expect, it } from 'vitest';

import type { RunMode } from '@code-zero/shared';

import {
  accessFromEnvironment,
  authenticate,
  sessionPrincipal,
  type ControlPlaneAccess,
} from './access.js';

const TOKEN_FORMAT_ERROR = /name:token/;
const UNKNOWN_PRINCIPAL_ERROR = /unknown principal/;

/** The grants the deployment configuration resolves; this package only consumes them. */
function grants(entries: Record<string, RunMode[]>): ReadonlyMap<string, readonly RunMode[]> {
  return new Map(Object.entries(entries));
}

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
    ...overrides,
  };
}

describe('accessFromEnvironment', () => {
  it('fails closed when no token is configured', () => {
    // Repository targeting no longer depends on this: a deployment that authenticates only browser
    // sessions still creates tasks, it just accepts no machine caller.
    expect(accessFromEnvironment(undefined)).toBeUndefined();
    expect(accessFromEnvironment('')).toBeUndefined();
    expect(accessFromEnvironment(' , ')).toBeUndefined();
  });

  it('parses name:token pairs', () => {
    const parsed = accessFromEnvironment('release-manager:tok1, ci:tok2');
    expect(parsed?.principals.get('tok1')?.name).toBe('release-manager');
    expect(parsed?.principals.get('tok2')?.name).toBe('ci');
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

  it('grants only the non-writable modes without an explicit grant', () => {
    expect(accessFromEnvironment('ops:tok')?.principals.get('tok')?.modes).toEqual([
      'observe',
      'suggest',
    ]);
  });

  it('applies the per-principal grants the deployment configuration resolved', () => {
    const parsed = accessFromEnvironment(
      'release-manager:tok1, ci:tok2',
      grants({ 'release-manager': ['observe', 'fix', 'autonomous'] }),
    );
    expect(parsed?.principals.get('tok1')?.modes).toEqual(['observe', 'fix', 'autonomous']);
    expect(parsed?.principals.get('tok2')?.modes).toEqual(['observe', 'suggest']);
  });

  it('refuses grants for principals that hold no token', () => {
    // A grant nobody can use is a typo in one of the two places, and the deployment should be told
    // which rather than quietly running with a narrower policy than it wrote down.
    expect(() => accessFromEnvironment('ops:tok', grants({ ghost: ['fix'] }))).toThrow(
      UNKNOWN_PRINCIPAL_ERROR,
    );
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
