import { describe, expect, it } from 'vitest';

import { organizationRoles, statements } from './access.js';

/** Whether `role` holds every action listed, on one resource. */
function may(role: keyof typeof organizationRoles, resource: string, actions: string[]): boolean {
  return organizationRoles[role].authorize({ [resource]: actions }).success;
}

describe('organization access control', () => {
  it('declares the Code Zero statements beside the plugin built-ins it cannot drop', () => {
    expect(statements).toMatchObject({
      repository: ['read', 'write', 'configure'],
      task: ['create', 'approve', 'cancel'],
      policy: ['write'],
      billing: ['manage'],
      member: expect.arrayContaining(['invite', 'remove', 'create', 'update', 'delete']),
      apiKey: expect.arrayContaining(['create', 'revoke']),
      invitation: ['create', 'cancel'],
      organization: ['update', 'delete'],
    });
  });

  it('gives owners every permission, billing and organization deletion included', () => {
    for (const [resource, actions] of Object.entries(statements)) {
      expect(may('owner', resource, [...actions])).toBe(true);
    }
  });

  it('lets admins run the organization but not its billing or its deletion', () => {
    expect(may('admin', 'repository', ['read', 'write', 'configure'])).toBe(true);
    expect(may('admin', 'task', ['create', 'approve', 'cancel'])).toBe(true);
    expect(may('admin', 'policy', ['write'])).toBe(true);
    expect(may('admin', 'member', ['invite', 'remove'])).toBe(true);
    expect(may('admin', 'apiKey', ['create', 'revoke'])).toBe(true);
    expect(may('admin', 'billing', ['manage'])).toBe(false);
    expect(may('admin', 'organization', ['delete'])).toBe(false);
  });

  it('confines members to reading repositories and starting tasks', () => {
    expect(may('member', 'repository', ['read'])).toBe(true);
    expect(may('member', 'task', ['create'])).toBe(true);
    expect(may('member', 'repository', ['write'])).toBe(false);
    expect(may('member', 'repository', ['configure'])).toBe(false);
    expect(may('member', 'task', ['approve'])).toBe(false);
    expect(may('member', 'task', ['cancel'])).toBe(false);
    expect(may('member', 'policy', ['write'])).toBe(false);
    expect(may('member', 'billing', ['manage'])).toBe(false);
    expect(may('member', 'member', ['invite'])).toBe(false);
    expect(may('member', 'member', ['remove'])).toBe(false);
    expect(may('member', 'apiKey', ['create'])).toBe(false);
    expect(may('member', 'apiKey', ['revoke'])).toBe(false);
  });

  it('keeps the two vocabularies in step on every role', () => {
    // Better Enrollment checks `invitation: ["create"]` and the API-key plugin checks its own CRUD
    // verbs, so a role must answer them exactly as it answers Code Zero's own actions.
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(may(role, 'invitation', ['create'])).toBe(may(role, 'member', ['invite']));
      expect(may(role, 'member', ['delete'])).toBe(may(role, 'member', ['remove']));
      expect(may(role, 'apiKey', ['delete'])).toBe(may(role, 'apiKey', ['revoke']));
      expect(may(role, 'apiKey', ['read', 'update'])).toBe(may(role, 'apiKey', ['create']));
    }
  });
});
