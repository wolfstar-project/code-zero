import { describe, expect, it } from 'vitest';

import { REDACTED, redactSecrets, secretValuesFromEnvironment, truncateTail } from './redact.js';

describe('secretValuesFromEnvironment', () => {
  it('collects credential-shaped names and ignores ordinary configuration', () => {
    const values = secretValuesFromEnvironment({
      GITHUB_TOKEN: 'ghs-token-value-1234',
      OPENAI_API_KEY: 'private-api-key-value',
      CODE_ZERO_MODEL: 'gpt-5',
      SHORT_TOKEN: 'abc',
      EMPTY_SECRET: '',
    });
    expect(values).toEqual(['ghs-token-value-1234', 'private-api-key-value']);
  });
});

describe('redactSecrets', () => {
  it('substitutes known values before shorter overlapping values', () => {
    const output = redactSecrets('value=abcdefghij and abcdefgh', ['abcdefgh', 'abcdefghij']);
    expect(output).toBe(`value=${REDACTED} and ${REDACTED}`);
  });

  it('removes credential shapes that never appeared in the environment', () => {
    const output = redactSecrets(
      [
        'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
        'authorization: Bearer abcdef.ghijkl',
        'GITHUB_TOKEN=super-secret-value',
        'AKIAIOSFODNN7EXAMPLE',
      ].join('\n'),
    );
    expect(output).not.toContain('ghp_0123456789');
    expect(output).not.toContain('abcdef.ghijkl');
    expect(output).not.toContain('super-secret-value');
    expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(output).toContain('GITHUB_TOKEN=[redacted]');
  });

  it('keeps prose that merely resembles a credential label', () => {
    expect(redactSecrets('monkey: banana')).toBe('monkey: banana');
    expect(redactSecrets('tokenizer: broken for empty input')).toBe(
      'tokenizer: broken for empty input',
    );
  });

  it('is idempotent so repeated reporting cannot leak on a second pass', () => {
    const once = redactSecrets('OPENAI_API_KEY=abcdefghijkl');
    expect(redactSecrets(once)).toBe(once);
  });
});

describe('truncateTail', () => {
  it('keeps the end of long output and reports what it dropped', () => {
    expect(truncateTail('abcdef', 3)).toBe('[truncated 3 characters]\ndef');
    expect(truncateTail('abc', 3)).toBe('abc');
  });
});
