import type { EvidenceBundle } from '@code-zero/shared';

/** A completed, verified issue run that has earned a pull request. */
export const issueBundle: EvidenceBundle = {
  taskId: 'cz_test',
  state: 'completed',
  verdict: 'accepted',
  verified: true,
  mode: 'fix',
  trigger: 'issue',
  source: 'github:acme/app#9',
  issue: { owner: 'acme', repo: 'app', number: 9 },
  runner: { kind: 'container', isolated: true, writable: true, network: 'none' },
  finding: {
    id: 'cz_test_finding',
    changeRisk: 'behavioral',
    title: 'Guard the null return in the loader',
    explanation: 'load() returns null but callers dereference it.',
    severity: 'high',
    confidence: 0.92,
    valid: true,
    evidence: ['`return null;` in src/user.ts'],
    files: ['src/user.ts'],
    verdict: 'accepted',
    rejectionReasons: [],
  },
  plan: ['Guard the null return'],
  acceptanceCriteria: ['load() never returns null'],
  changedFiles: ['src/user.ts'],
  checks: [{ command: 'pnpm run test', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 10 }],
  attempts: 1,
  transitions: [],
  summary: 'Fixed and verified: Guard the null return in the loader',
};

/** A review run's evidence, verified and passing unless overridden. */
export function reviewBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    ...issueBundle,
    mode: 'observe',
    trigger: 'feedback',
    source: null,
    issue: null,
    runner: { kind: 'local', isolated: false, writable: false, network: 'none' },
    summary: 'Review summary',
    ...overrides,
  };
}
