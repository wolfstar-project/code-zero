import { describe, expect, it } from 'vitest';

import {
  isNotFoundStatus,
  isServerErrorStatus,
  resolveErrorStatus,
} from '../../modules/shared/utils/error-status.js';

describe('resolveErrorStatus', () => {
  it('prefers the Nuxt-normalized status', () => {
    expect(resolveErrorStatus({ status: 404, statusCode: 500 })).toBe(404);
  });

  it('falls back to the raw h3 statusCode', () => {
    expect(resolveErrorStatus({ statusCode: 502 })).toBe(502);
  });

  it('defaults to 500 when no status is attached', () => {
    expect(resolveErrorStatus({})).toBe(500);
  });
});

describe('status predicates', () => {
  it('flags 404 as not found', () => {
    expect(isNotFoundStatus(404)).toBe(true);
    expect(isNotFoundStatus(410)).toBe(false);
  });

  it('flags 5xx as server errors', () => {
    expect(isServerErrorStatus(500)).toBe(true);
    expect(isServerErrorStatus(503)).toBe(true);
    expect(isServerErrorStatus(404)).toBe(false);
  });
});
