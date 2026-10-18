import type { Actor } from 'forges';

/** Untrusted comment bodies are bounded before they reach a prompt or an evidence report. */
export const MAX_FEEDBACK_BODY = 8_000;
/** Untrusted issue titles and bodies are bounded before they reach a prompt or a report. */
export const MAX_ISSUE_TITLE = 300;
export const MAX_ISSUE_BODY = 20_000;

// Bitbucket reports 12-character hashes, so the floor is the shortest unambiguous git abbreviation.
const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/;

export function readSha(value: string | undefined): string | undefined {
  return value !== undefined && COMMIT_SHA.test(value) ? value : undefined;
}

/** A thread number as `forges` carries it, a string, read as the positive integer it must be. */
export function readNumber(value: string | undefined): number | undefined {
  return value !== undefined && POSITIVE_INTEGER.test(value) ? Number(value) : undefined;
}

/** A trimmed, bounded body, or null when there is nothing to act on. */
export function readBody(body: string | undefined, max: number): string | null {
  const trimmed = body?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

export interface AuthorFilter {
  /**
   * Logins whose feedback and issues are ignored, normally including the account Code Zero posts
   * as. Without this a run reacts to its own comments and loops.
   */
  ignoreAuthors?: readonly string[];
  /**
   * Whether feedback and issues from automation accounts are ingested. AI reviewers are a
   * first-class source, so this defaults to true. `forges` derives the bot hint from forge
   * metadata, so it only filters what the forge reveals.
   */
  allowBots?: boolean;
}

/** Why an author is refused, or null when the author is accepted. */
export function refuseAuthor(actor: Actor | undefined, filter: AuthorFilter): string | null {
  if (!actor || actor.login.length === 0) return 'the author is not identified';
  const login = actor.login.toLowerCase();
  if ((filter.ignoreAuthors ?? []).some((ignored) => ignored.toLowerCase() === login))
    return `${actor.login} is an ignored author`;
  if (filter.allowBots === false && actor.isBotHint) return `${actor.login} is a bot`;
  return null;
}
