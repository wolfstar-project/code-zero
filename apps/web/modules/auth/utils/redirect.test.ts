import { describe, expect, it } from 'vitest';

import { safeLocalRedirect } from './redirect';

describe('safeLocalRedirect', () => {
  it.each(['/', '/device?user_code=ABCD-EFGH', '/settings#limits', '/organizations'])(
    'keeps the local path %j',
    (path) => {
      expect(safeLocalRedirect(path)).toBe(path);
    },
  );

  it('takes the first value when the query repeats the key', () => {
    expect(safeLocalRedirect(['/audit', '/settings'])).toBe('/audit');
  });

  it.each([
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example/',
    'javascript:alert(1)',
    'device',
    '/audit\n',
    '/audit\u007f',
    '',
    undefined,
    null,
    42,
  ])('refuses %j, which is not a path on this app', (value) => {
    expect(safeLocalRedirect(value)).toBeUndefined();
  });

  it.each(['/login', '/signup?x=1', '/two-factor#code'])(
    'refuses %j, which would start another sign-in',
    (value) => {
      expect(safeLocalRedirect(value)).toBeUndefined();
    },
  );
});
