import type { ValidationPolicy } from '@code-zero/config';
import type { ModelFinding } from '@code-zero/shared';
import { describe, expect, it } from 'vitest';

import { quotedSpans, validateFinding, type ValidationProbe } from './validation.js';

const policy: ValidationPolicy = {
  minConfidence: 0.6,
  requireEvidence: true,
  requireKnownFiles: true,
  verifyQuotedEvidence: true,
};

const files: Record<string, string> = {
  'src/user.ts': 'export function load() {\n  return null;\n}\n',
};

const probe: ValidationProbe = {
  exists: async (path) => path in files,
  read: async (path) => {
    const content = files[path];
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  },
};

function finding(overrides: Partial<ModelFinding> = {}): ModelFinding {
  return {
    title: 'Null return is dereferenced',
    explanation: 'load() returns null.',
    severity: 'high',
    confidence: 0.9,
    valid: true,
    evidence: ['`return null;` appears in src/user.ts'],
    files: ['src/user.ts'],
    ...overrides,
  };
}

describe('validateFinding', () => {
  it('accepts a claim backed by a real file and a real quote', async () => {
    await expect(validateFinding(finding(), policy, probe)).resolves.toEqual({
      verdict: 'accepted',
      reasons: [],
    });
  });

  it('rejects a claim the model itself could not support', async () => {
    const outcome = await validateFinding(finding({ valid: false }), policy, probe);
    expect(outcome.verdict).toBe('rejected');
    expect(outcome.reasons[0]).toContain('could not be supported');
  });

  it('rejects a claim with no evidence', async () => {
    const outcome = await validateFinding(finding({ evidence: ['  '] }), policy, probe);
    expect(outcome.verdict).toBe('rejected');
    expect(outcome.reasons).toContain('No evidence was cited for the claim.');
  });

  it('rejects a claim citing a file that does not exist', async () => {
    const outcome = await validateFinding(
      finding({ files: ['src/ghost.ts'], evidence: ['it is broken'] }),
      policy,
      probe,
    );
    expect(outcome.verdict).toBe('rejected');
    expect(outcome.reasons[0]).toContain('None of the cited files exist');
  });

  it('rejects a claim that names no file at all', async () => {
    const outcome = await validateFinding(finding({ files: [] }), policy, probe);
    expect(outcome.verdict).toBe('rejected');
    expect(outcome.reasons).toContain('The claim does not name any repository file.');
  });

  it('rejects a path that tries to leave the checkout', async () => {
    const outcome = await validateFinding(finding({ files: ['../../etc/passwd'] }), policy, probe);
    expect(outcome.verdict).toBe('rejected');
    expect(outcome.reasons[0]).toContain('not inside the checkout');
  });

  it('rejects fabricated quotes that no cited file contains', async () => {
    const outcome = await validateFinding(
      finding({ evidence: ['`throw new RangeError("nope")` is called here'] }),
      policy,
      probe,
    );
    expect(outcome.verdict).toBe('rejected');
    expect(outcome.reasons[0]).toContain('Quoted evidence does not appear');
  });

  it('accepts when at least one quote is real', async () => {
    const outcome = await validateFinding(
      finding({ evidence: ['`return null;` here', '`imagined()` there'] }),
      policy,
      probe,
    );
    expect(outcome.verdict).toBe('accepted');
  });

  it('rejects a confidence outside the reportable range', async () => {
    const outcome = await validateFinding(finding({ confidence: 7 }), policy, probe);
    expect(outcome.verdict).toBe('rejected');
    expect(outcome.reasons[0]).toContain('outside 0 to 1');
  });

  it('reports a supported but low-confidence claim as inconclusive', async () => {
    const outcome = await validateFinding(finding({ confidence: 0.4 }), policy, probe);
    expect(outcome.verdict).toBe('inconclusive');
    expect(outcome.reasons[0]).toContain('below the 0.60 required');
  });

  it('collects every reason rather than stopping at the first', async () => {
    const outcome = await validateFinding(
      finding({ valid: false, evidence: [], files: ['src/ghost.ts'] }),
      policy,
      probe,
    );
    expect(outcome.reasons).toHaveLength(3);
  });

  it('honors a policy that disables the individual gates', async () => {
    const relaxed = {
      minConfidence: 0,
      requireEvidence: false,
      requireKnownFiles: false,
      verifyQuotedEvidence: false,
    };
    const outcome = await validateFinding(
      finding({ evidence: [], files: [], confidence: 0 }),
      relaxed,
      probe,
    );
    expect(outcome.verdict).toBe('accepted');
  });
});

describe('quotedSpans', () => {
  it('collects distinct quotes long enough to identify code', () => {
    expect(quotedSpans(['`return null;` and `x` and `return null;`'])).toEqual(['return null;']);
  });

  it('returns nothing when evidence quotes nothing', () => {
    expect(quotedSpans(['the loader is wrong'])).toEqual([]);
  });
});
