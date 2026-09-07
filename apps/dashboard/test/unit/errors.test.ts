import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { errors } from '../../server/utils/errors.js';

describe('errors', () => {
  it('answers an unmatched path with a 404 the transports share', () => {
    const error = errors.notFound();
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Not found');
  });

  it('names the missing variable without exposing any value', () => {
    const error = errors.misconfigured('GITHUB_WEBHOOK_SECRET');
    expect(error.statusCode).toBe(503);
    expect(error.message).toBe('GITHUB_WEBHOOK_SECRET is not configured');
  });

  it('redacts an unexpected failure, leaving the credential nowhere on the error', () => {
    const token = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz12';
    const error = errors.internal(new Error(`token ${token} leaked`));
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe('token [redacted] leaked');
    // Nitro logs the thrown error whole, so nothing reachable from it may carry the original
    // message — including the `cause` chain a naive `createError({ cause })` would attach.
    expect(inspect(error, { depth: null })).not.toContain(token);
  });

  it('accepts a thrown non-Error value', () => {
    expect(errors.internal('plain failure').message).toBe('plain failure');
  });

  it('marks every error `fatal: false` and `unhandled: false`, so Nitro forwards `message` instead of replacing it', () => {
    // Nitro's own error handler — not bare h3's `sendError`, which drops `message` — serves every
    // response in this app. It forwards `error.message` verbatim only while both flags read
    // falsy. `EvlogError` itself never declares either one, so this module sets both to `false`
    // explicitly rather than leaving them `undefined`: functionally identical for Nitro's truthy
    // check, but it is what lets an assertion elsewhere that expects the fields to be exactly
    // `false` pass. Either flag present and truthy would make the client see a generic
    // "Server Error" instead.
    for (const error of [
      errors.notFound(),
      errors.misconfigured('GITHUB_WEBHOOK_SECRET'),
      errors.forbidden('nope'),
      errors.tooManyRequests('slow down'),
      errors.internal(new Error('boom')),
    ]) {
      expect(error.fatal).toBe(false);
      expect(error.unhandled).toBe(false);
    }
  });
});
