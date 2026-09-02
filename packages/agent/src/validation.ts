import type { ValidationPolicy } from '@code-zero/config';
import { isRepositoryRelativePath, type ModelFinding, type Verdict } from '@code-zero/shared';

/** The repository lookups validation needs. Satisfied by the runner boundary. */
export interface ValidationProbe {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
}

export interface ValidationOutcome {
  verdict: Verdict;
  /** Why the finding was not accepted. Empty when accepted. */
  reasons: string[];
}

export interface ValidationScope {
  /** At least one cited file must belong to this diff when the field is present. */
  requiredFiles?: readonly string[];
}

/** Shortest backtick-quoted span worth checking against the repository. */
const MINIMUM_QUOTE_LENGTH = 8;

/**
 * Decide whether review feedback is actually supported by the repository.
 *
 * Reviewer claims and model output are both untrusted, so neither a reviewer's insistence nor a
 * model's self-reported confidence is treated as proof. A finding is accepted only when it cites
 * evidence, names a file that exists, and — when it quotes repository content — quotes something
 * that is really there. Anything unsupported is rejected with its reasons preserved; anything
 * supported but low-confidence is inconclusive and never fixed automatically.
 */
export async function validateFinding(
  finding: ModelFinding,
  policy: ValidationPolicy,
  probe: ValidationProbe,
  scope: ValidationScope = {},
): Promise<ValidationOutcome> {
  const reasons: string[] = [];

  if (!finding.valid) reasons.push('The claim could not be supported by repository evidence.');

  if (!Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1)
    reasons.push(`Reported confidence ${String(finding.confidence)} is outside 0 to 1.`);

  const evidence = finding.evidence.filter((entry) => entry.trim().length > 0);
  if (policy.requireEvidence && evidence.length === 0)
    reasons.push('No evidence was cited for the claim.');

  const unsafe = finding.files.filter((path) => !isRepositoryRelativePath(path));
  if (unsafe.length > 0)
    reasons.push(`Cited paths are not inside the checkout: ${unsafe.join(', ')}.`);

  const candidates = finding.files.filter((path) => isRepositoryRelativePath(path));
  if (scope.requiredFiles) {
    const required = new Set(scope.requiredFiles.map(normalizePath));
    if (required.size === 0)
      reasons.push('The proactive review diff does not contain any files to inspect.');
    else if (!candidates.some((path) => required.has(normalizePath(path))))
      reasons.push('The finding does not cite a file changed by the proactive review diff.');
  }
  const known: string[] = [];
  const missing: string[] = [];
  for (const path of candidates) {
    if (await probe.exists(path)) known.push(path);
    else missing.push(path);
  }

  if (policy.requireKnownFiles && known.length === 0)
    reasons.push(
      candidates.length === 0
        ? 'The claim does not name any repository file.'
        : `None of the cited files exist in the checkout: ${missing.join(', ')}.`,
    );

  if (policy.verifyQuotedEvidence && known.length > 0) {
    const quotes = quotedSpans(evidence);
    if (quotes.length > 0 && !(await anyQuoteAppears(quotes, known, probe)))
      reasons.push(
        `Quoted evidence does not appear in the cited files: ${quotes.map((quote) => `\`${quote}\``).join(', ')}.`,
      );
  }

  if (reasons.length > 0) return { verdict: 'rejected', reasons };

  if (finding.confidence < policy.minConfidence)
    return {
      verdict: 'inconclusive',
      reasons: [
        `Confidence ${finding.confidence.toFixed(2)} is below the ${policy.minConfidence.toFixed(2)} required to act.`,
      ],
    };

  return { verdict: 'accepted', reasons: [] };
}

const LEADING_DOT_SLASH = /^\.\//;

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(LEADING_DOT_SLASH, '');
}

/** Extract backtick-quoted spans long enough to identify real repository content. */
export function quotedSpans(evidence: readonly string[]): string[] {
  const spans = new Set<string>();
  for (const entry of evidence)
    for (const match of entry.matchAll(/`([^`]+)`/g)) {
      const span = match[1]?.trim() ?? '';
      if (span.length >= MINIMUM_QUOTE_LENGTH) spans.add(span);
    }
  return [...spans];
}

/**
 * A single verified quote is enough.
 *
 * Requiring every quote to match would reject findings that paraphrase alongside a real citation,
 * while requiring none would let a wholly invented citation through.
 */
async function anyQuoteAppears(
  quotes: readonly string[],
  files: readonly string[],
  probe: ValidationProbe,
): Promise<boolean> {
  const contents: string[] = [];
  for (const path of files) {
    try {
      contents.push(await probe.read(path));
    } catch {
      // An unreadable file cannot confirm a quote; other cited files still can.
      continue;
    }
  }
  return quotes.some((quote) => contents.some((content) => content.includes(quote)));
}
