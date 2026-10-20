import { describe, expect, it } from 'vitest';

import { isSafeBranchName, issueBranchName } from './branch-names.js';

describe('branch names', () => {
  it('derives a deterministic branch from policy, issue number, and task id', () => {
    expect(issueBranchName('code-zero/', 12, 'cz_ABC-123')).toBe('code-zero/issue-12-cz-abc-123');
    expect(issueBranchName('', 12, '!!!')).toBe('issue-12');
  });

  it('refuses anything that could smuggle ref syntax', () => {
    for (const name of [
      '',
      '../heads/main',
      'code-zero/../main',
      'refs/heads/x.lock',
      '-leading-dash',
      'has space',
      'trailing/',
      'double//slash',
      'tilde~1',
      'caret^',
      'colon:x',
      'back\\slash',
      'a'.repeat(201),
    ])
      expect(isSafeBranchName(name)).toBe(false);
    expect(() => issueBranchName('bad prefix ', 12, 'cz_1')).toThrow('unsafe branch name');
  });

  it('accepts ordinary branch names', () => {
    for (const name of ['main', 'code-zero/issue-9-cz-1', 'release/v1.2.3', 'feat_x'])
      expect(isSafeBranchName(name)).toBe(true);
  });
});
