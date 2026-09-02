import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { schema } from './index.js';

describe('two-factor authentication schema', () => {
  it('persists whether a user has completed two-factor setup', () => {
    const columns = getTableConfig(schema.user).columns.map((column) => column.name);

    expect(columns).toContain('two_factor_enabled');
  });

  it('persists TOTP secrets and backup codes in the Better Auth model', () => {
    const table = schema.twoFactor;

    expect(table).toBeDefined();
    expect(getTableConfig(table).columns.map((column) => column.name)).toEqual([
      'id',
      'secret',
      'backup_codes',
      'user_id',
      'verified',
      'failed_verification_count',
      'locked_until',
      'created_at',
      'updated_at',
    ]);
  });
});
