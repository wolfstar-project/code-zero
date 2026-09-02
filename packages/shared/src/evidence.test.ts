import { describe, expect, it } from 'vitest';

import { evidenceFromResult, renderEvidenceMarkdown, type EvidenceBundle } from './evidence.js';
import { allChecksPassed, isRepositoryRelativePath, type TaskResult } from './types.js';

const result: TaskResult = {
  id: 'cz_test',
  state: 'completed',
  verdict: 'accepted',
  verified: true,
  finding: {
    id: 'cz_test_finding',
    changeRisk: 'mechanical',
    title: 'Unhandled null dereference',
    explanation: 'The loader returns null but the caller dereferences it.',
    severity: 'high',
    confidence: 0.91,
    valid: true,
    evidence: ['`return null;` in src/user.ts'],
    files: ['src/user.ts'],
    verdict: 'accepted',
    rejectionReasons: [],
  },
  plan: ['Guard the null return'],
  acceptanceCriteria: [],
  checks: [{ command: 'pnpm run test', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 12 }],
  changedFiles: ['src/user.ts'],
  attempts: 1,
  events: [{ state: 'completed', message: 'All configured checks passed', timestamp: 'T0' }],
  usage: {
    modelCalls: 1,
    inputTokens: 100,
    outputTokens: 25,
    totalTokens: 125,
    latencyMs: 400,
    costUsd: 0.001,
    models: { 'gpt-5': 1 },
  },
  runner: { kind: 'container', isolated: true, writable: true, network: 'none' },
  summary: 'Fixed and verified: Unhandled null dereference',
};

const bundle = evidenceFromResult(result, { mode: 'fix', source: 'github:acme/app#7' });

describe('evidenceFromResult', () => {
  it('copies collections so later mutation cannot rewrite stored evidence', () => {
    const snapshot = evidenceFromResult(result, { mode: 'fix' });
    result.changedFiles.push('src/other.ts');
    expect(snapshot.changedFiles).toEqual(['src/user.ts']);
    result.changedFiles.pop();
  });

  it('records the absence of a source instead of inventing one', () => {
    expect(evidenceFromResult(result, { mode: 'observe' }).source).toBeNull();
  });

  it('records the issue an issue task worked on, and its absence otherwise', () => {
    const issue = { owner: 'acme', repo: 'app', number: 12 };
    const snapshot = evidenceFromResult(result, { mode: 'fix', trigger: 'issue', issue });
    expect(snapshot.issue).toEqual(issue);
    expect(snapshot.issue).not.toBe(issue);
    expect(evidenceFromResult(result, { mode: 'observe' }).issue).toBeNull();
  });
});

describe('renderEvidenceMarkdown', () => {
  it('is deterministic for the same bundle', () => {
    expect(renderEvidenceMarkdown(bundle)).toBe(renderEvidenceMarkdown(bundle));
  });

  it('reports a passing run as verified with the runner that produced it', () => {
    const report = renderEvidenceMarkdown(bundle);
    expect(report).toContain('## Code Zero — feedback accepted');
    expect(report).toContain('passed (1 checks)');
    expect(report).toContain('`container` (isolated, read-write, network `none`)');
  });

  it('never presents a failed check as verified and keeps the failing output', () => {
    const failing: EvidenceBundle = {
      ...bundle,
      state: 'needs-human',
      verified: false,
      checks: [
        {
          command: 'pnpm run test',
          exitCode: 1,
          stdout: 'expected true to be false',
          stderr: '',
          durationMs: 9,
        },
      ],
    };
    const report = renderEvidenceMarkdown(failing);
    expect(report).toContain('failed (1 of 1 checks)');
    expect(report).not.toContain('passed (');
    expect(report).toContain('expected true to be false');
  });

  it('preserves the reasons a rejected finding was not accepted', () => {
    const rejected: EvidenceBundle = {
      ...bundle,
      verdict: 'rejected',
      verified: false,
      checks: [],
      changedFiles: [],
      finding: {
        ...result.finding!,
        verdict: 'rejected',
        valid: false,
        rejectionReasons: ['Cited file src/ghost.ts does not exist in the checkout.'],
      },
    };
    const report = renderEvidenceMarkdown(rejected);
    expect(report).toContain('## Code Zero — feedback rejected');
    expect(report).toContain('### Why this was not accepted');
    expect(report).toContain('src/ghost.ts does not exist');
    expect(report).toContain('No repository-native checks were executed.');
  });

  it('redacts credentials captured in check output', () => {
    const leaking: EvidenceBundle = {
      ...bundle,
      verified: false,
      checks: [
        {
          command: 'pnpm run test',
          exitCode: 1,
          stdout: 'using ghp_0123456789abcdefghijklmnopqrstuvwxyz',
          stderr: '',
          durationMs: 5,
        },
      ],
    };
    const report = renderEvidenceMarkdown(leaking, { secrets: ['local-secret-value'] });
    expect(report).not.toContain('ghp_0123456789');
  });

  it('respects the output ceiling so a check run can always accept it', () => {
    const noisy: EvidenceBundle = {
      ...bundle,
      summary: 'x'.repeat(5_000),
    };
    expect(renderEvidenceMarkdown(noisy, { maxLength: 500 }).length).toBeLessThanOrEqual(500);
  });

  it('labels an issue task and renders its acceptance criteria', () => {
    const issueBundle: EvidenceBundle = {
      ...bundle,
      trigger: 'issue',
      issue: { owner: 'acme', repo: 'app', number: 12 },
      acceptanceCriteria: ['The loader guards its null return before dereferencing'],
    };
    const report = renderEvidenceMarkdown(issueBundle);
    expect(report).toContain('## Code Zero — issue task accepted');
    expect(report).toContain('### Acceptance criteria');
    expect(report).toContain('The loader guards its null return before dereferencing');
  });

  it('keeps a table cell from breaking the surrounding row', () => {
    const piped: EvidenceBundle = {
      ...bundle,
      checks: [{ command: 'sh -c "a | b"', exitCode: 0, stdout: '', stderr: '', durationMs: 1 }],
    };
    expect(renderEvidenceMarkdown(piped)).toContain('a \\| b');
  });
});

describe('contract helpers', () => {
  it('treats an empty check list as unverified', () => {
    expect(allChecksPassed([])).toBe(false);
    expect(allChecksPassed(result.checks)).toBe(true);
  });

  it('rejects paths that leave the checkout or reach into git metadata', () => {
    expect(isRepositoryRelativePath('src/user.ts')).toBe(true);
    expect(isRepositoryRelativePath('../secret')).toBe(false);
    expect(isRepositoryRelativePath('/etc/passwd')).toBe(false);
    expect(isRepositoryRelativePath('C:\\windows\\system32')).toBe(false);
    expect(isRepositoryRelativePath('.git/config')).toBe(false);
    expect(isRepositoryRelativePath('src/../../escape')).toBe(false);
    expect(isRepositoryRelativePath('')).toBe(false);
  });
});
