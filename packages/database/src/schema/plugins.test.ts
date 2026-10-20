import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { schema } from './index.js';

/** The SQL column names a table declares, in declaration order. */
function columnsOf(table: PgTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

/** Whether `column` on `table` carries a foreign key that cascades from `user.id`. */
function cascadesFromUser(table: PgTable, column: string): boolean {
  return getTableConfig(table).foreignKeys.some((foreignKey) => {
    const reference = foreignKey.reference();
    return (
      reference.columns.some((local) => local.name === column) &&
      getTableConfig(reference.foreignTable).name === 'user' &&
      foreignKey.onDelete === 'cascade'
    );
  });
}

// The Better Auth Drizzle adapter maps model fields to columns by name, so a column missing here
// is not a build error: the plugin's write silently drops the field, or its read finds nothing.
// Each expectation below is the plugin's own `schema` in 1.7, cross-checked against the generator.
describe('Better Auth plugin columns', () => {
  it('records two-factor enrollment and the admin ban on the user', () => {
    expect(columnsOf(schema.user)).toEqual(
      expect.arrayContaining(['role', 'two_factor_enabled', 'banned', 'ban_reason', 'ban_expires']),
    );
  });

  it('records who is impersonating through a session, and drops it with that administrator', () => {
    expect(columnsOf(schema.session)).toContain('impersonated_by');
    expect(cascadesFromUser(schema.session, 'impersonated_by')).toBe(true);
  });

  it('stores TOTP secrets and backup codes with the plugin lockout counters', () => {
    expect(columnsOf(schema.twoFactor)).toEqual([
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
    expect(cascadesFromUser(schema.twoFactor, 'user_id')).toBe(true);
  });

  it('stores one passkey per credential id', () => {
    expect(columnsOf(schema.passkey)).toEqual([
      'id',
      'name',
      'public_key',
      'user_id',
      'credential_id',
      'counter',
      'device_type',
      'backed_up',
      'transports',
      'aaguid',
      'created_at',
    ]);
    const unique = getTableConfig(schema.passkey).indexes.filter((index) => index.config.unique);
    expect(unique.map((index) => index.config.name)).toEqual(['passkey_credential_id_unique']);
  });

  it('stores API keys by hash under the model name the plugin resolves', () => {
    expect(getTableConfig(schema.apikey).name).toBe('api_key');
    expect(columnsOf(schema.apikey)).toEqual(
      expect.arrayContaining([
        'config_id',
        'reference_id',
        'prefix',
        'start',
        'key',
        'enabled',
        'rate_limit_enabled',
        'rate_limit_time_window',
        'rate_limit_max',
        'request_count',
        'remaining',
        'expires_at',
        'permissions',
        'metadata',
      ]),
    );
    // Plaintext is returned once at creation; no column could hold it.
    expect(columnsOf(schema.apikey)).not.toContain('plaintext');
  });

  it('stores SSO providers with the domain they route and whether it was verified', () => {
    expect(columnsOf(schema.ssoProvider)).toEqual([
      'id',
      'issuer',
      'oidc_config',
      'saml_config',
      'user_id',
      'provider_id',
      'organization_id',
      'domain',
      'domain_verified',
    ]);
  });

  it('keeps SCIM bearer credentials as digests only', () => {
    expect(columnsOf(schema.scimManagedCredential)).toContain('token_digest');
    expect(columnsOf(schema.scimManagedCredential)).not.toContain('token');
  });
});
