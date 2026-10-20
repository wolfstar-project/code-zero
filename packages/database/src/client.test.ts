import { describe, expect, it } from 'vitest';

import {
  createScopedDatabase,
  databaseUrlFromEnvironment,
  optionalDatabaseUrlFromEnvironment,
} from './client.js';
import { schema } from './schema/index.js';

const CONNECTION_STRING = 'postgres://postgres:postgres@localhost:5432/code_zero';
const MISSING_URL_MESSAGE = /DATABASE_URL/;

describe('databaseUrlFromEnvironment', () => {
  it('reads the connection string from DATABASE_URL', () => {
    expect(databaseUrlFromEnvironment({ DATABASE_URL: CONNECTION_STRING })).toBe(CONNECTION_STRING);
  });

  it('falls back to AUTH_DATABASE_URL so a pre-split deployment still starts', () => {
    expect(databaseUrlFromEnvironment({ AUTH_DATABASE_URL: CONNECTION_STRING })).toBe(
      CONNECTION_STRING,
    );
  });

  it('prefers DATABASE_URL over the legacy variable', () => {
    expect(
      databaseUrlFromEnvironment({
        DATABASE_URL: CONNECTION_STRING,
        AUTH_DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/legacy',
      }),
    ).toBe(CONNECTION_STRING);
  });

  it.each(['', '   '])(
    'falls back to the legacy variable when DATABASE_URL is set to %j',
    (blank) => {
      // A blank value is configuration that was cleared, not configuration that means "no
      // database": treating it as set would point a migration at nothing while a usable legacy
      // connection string sits right beside it.
      expect(
        databaseUrlFromEnvironment({
          DATABASE_URL: blank,
          AUTH_DATABASE_URL: CONNECTION_STRING,
        }),
      ).toBe(CONNECTION_STRING);
    },
  );

  it('refuses to start when neither variable is set', () => {
    expect(() => databaseUrlFromEnvironment({})).toThrow(MISSING_URL_MESSAGE);
  });

  it('treats a blank value as unset rather than connecting to an empty host', () => {
    expect(() => databaseUrlFromEnvironment({ DATABASE_URL: '   ' })).toThrow(MISSING_URL_MESSAGE);
  });

  it('names the missing variable without echoing a configured connection string', () => {
    let message = '';
    try {
      databaseUrlFromEnvironment({ DATABASE_URL: '' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('postgres://');
  });
});

describe('optionalDatabaseUrlFromEnvironment', () => {
  // `drizzle.config.ts` resolves through this function and substitutes a local default, so a
  // blank value has to read as absent there too.
  it.each([{}, { DATABASE_URL: '' }, { DATABASE_URL: '  ', AUTH_DATABASE_URL: '' }])(
    'reports %j as unconfigured rather than returning a blank string',
    (environment) => {
      expect(optionalDatabaseUrlFromEnvironment(environment)).toBeUndefined();
    },
  );

  it('applies the same precedence as the throwing resolver', () => {
    expect(
      optionalDatabaseUrlFromEnvironment({
        DATABASE_URL: CONNECTION_STRING,
        AUTH_DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/legacy',
      }),
    ).toBe(CONNECTION_STRING);
  });
});

describe('schema', () => {
  // Better Auth resolves its models by key, so a table dropped from this object stops being
  // written without any type error to catch it.
  it('exposes every model the Better Auth adapter resolves', () => {
    expect(Object.keys(schema).toSorted()).toEqual([
      'account',
      'apikey',
      'deviceCode',
      'invitation',
      'invite',
      'inviteUse',
      'member',
      'organization',
      'passkey',
      'repository',
      'scimConnectionBinding',
      'scimGroup',
      'scimGroupMember',
      'scimIdentityTombstone',
      'scimManagedConnection',
      'scimManagedConnectionEvent',
      'scimManagedCredential',
      'scimProjectionGrant',
      'scimSubject',
      'scimUser',
      'session',
      'ssoProvider',
      'twoFactor',
      'user',
      'verification',
    ]);
  });
});

// A stand-in with the one thing the proxy relies on: members that read `this`. Nothing here
// opens a socket, which is what keeps the test deterministic.
interface Probe {
  readonly name: string;
  describe(): string;
}

function probe(name: string): Probe {
  return {
    name,
    describe() {
      return this.name;
    },
  };
}

describe('createScopedDatabase', () => {
  it('answers from whichever client is current when a member is read', () => {
    let current = probe('first');
    const scoped = createScopedDatabase(() => current);

    expect(scoped.name).toBe('first');
    current = probe('second');
    expect(scoped.name).toBe('second');
  });

  it('runs a method against the client it was read from, even when called detached', () => {
    let current = probe('first');
    const scoped = createScopedDatabase(() => current);

    // Detached on purpose: this is the case under test.
    // oxlint-disable-next-line typescript/unbound-method -- reading the method off the proxy is the point
    const detached = scoped.describe;
    current = probe('second');

    expect(detached()).toBe('first');
    expect(scoped.describe()).toBe('second');
  });

  it('opens nothing until a member is used', () => {
    let resolutions = 0;
    createScopedDatabase(() => {
      resolutions += 1;
      return probe('unused');
    });

    expect(resolutions).toBe(0);
  });

  it('lets a failure to resolve a client reach the caller', () => {
    const scoped = createScopedDatabase((): Probe => {
      throw new Error('no request in progress');
    });

    expect(() => scoped.name).toThrow('no request in progress');
  });
});
