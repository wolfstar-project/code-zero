import { describe, expect, it } from 'vitest';

import { databaseUrlFromEnvironment, optionalDatabaseUrlFromEnvironment } from './client.js';
import { schema } from './schema/index.js';

const CONNECTION_STRING = 'postgres://postgres:postgres@localhost:5432/agent_zero';
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
      'deviceCode',
      'invitation',
      'invite',
      'inviteUse',
      'member',
      'organization',
      'session',
      'twoFactor',
      'user',
      'verification',
    ]);
  });
});
