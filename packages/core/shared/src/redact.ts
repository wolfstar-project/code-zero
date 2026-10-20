/** Replacement written in place of anything that looks like a credential. */
export const REDACTED = '[redacted]';

/** Shortest environment value that is worth substituting; shorter values match too much text. */
const MINIMUM_SECRET_LENGTH = 8;

const SENSITIVE_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|SESSION|COOKIE)/i;

/**
 * Credential shapes that must never survive into evidence, even when the value is not present in
 * the current environment (for example a token pasted into review feedback).
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

/**
 * `authorization: Bearer x` and `GITHUB_TOKEN=x` style assignments, keeping the label readable.
 *
 * The sensitive word must either start the name or follow a separator, so ordinary prose such as
 * `monkey: banana` or `tokenizer: broken` survives into evidence unchanged.
 */
const ASSIGNMENT_PATTERNS: readonly RegExp[] = [
  /\b(authorization\s*[:=]\s*)(?:bearer\s+|token\s+)?\S+/gi,
  /\b((?:[A-Za-z0-9]+[_.-])?(?:api[_.-]?key|token|secret|password|passwd|credentials?)\s*[:=]\s*)(?!\s)(?:"[^"]*"|'[^']*'|\S+)/gi,
];

/**
 * Collect values of environment variables whose names suggest they hold a credential.
 *
 * The environment is passed in so callers stay deterministic in tests.
 */
export function secretValuesFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(environment)) {
    if (!value || value.length < MINIMUM_SECRET_LENGTH) continue;
    if (SENSITIVE_NAME.test(name)) values.push(value);
  }
  return values;
}

/**
 * Remove credentials from text that is about to be logged, stored as evidence, published to
 * GitHub, or sent to a model provider.
 *
 * Longer secrets are substituted first so that a value containing another value cannot leave a
 * partial match behind.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let output = text;
  const unique = [...new Set(secrets)]
    .filter((secret) => secret.length >= MINIMUM_SECRET_LENGTH)
    .toSorted((left, right) => right.length - left.length);
  for (const secret of unique) output = output.split(secret).join(REDACTED);
  for (const pattern of CREDENTIAL_PATTERNS) output = output.replace(pattern, REDACTED);
  for (const pattern of ASSIGNMENT_PATTERNS)
    output = output.replace(pattern, (_match, label: string) => `${label}${REDACTED}`);
  return output;
}

/** Keep the tail of a command output, which is where failures explain themselves. */
export function truncateTail(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `[truncated ${String(text.length - maxLength)} characters]\n${text.slice(-maxLength)}`;
}

/** Keep the head of a value, used where the beginning carries the meaning. */
export function truncateHead(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n[truncated ${String(text.length - maxLength)} characters]`;
}
