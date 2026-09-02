/**
 * The contract between the template compiler (`scripts/compile-templates.ts`) and the sender
 * (`../mail.ts`).
 *
 * Maizzle renders a Vue SFC by starting a Vite SSR server, which is a build-time capability: it
 * needs a bundler, its platform-native binary, and a writable working directory, none of which a
 * serverless function has. So the templates are rendered once at build time into the artifact
 * described here, and sending is reduced to selecting a variant and substituting placeholders.
 *
 * Both halves therefore have to agree on three things — how a placeholder is spelled, how a
 * variant is named, and how a value is escaped — which is why all three live in this one module
 * rather than being restated on each side.
 */

import type { MailTemplateId } from './templates.js';

/** One rendered variant: the message as a mail client sees it, and its plaintext alternative. */
export interface CompiledMailTemplate {
  readonly html: string;
  readonly text: string;
}

/**
 * Every template's variants, keyed by {@link mailTemplateVariantKey}.
 *
 * A template that branches on nothing has the single `''` variant.
 */
export type CompiledMailTemplates = {
  readonly [Id in MailTemplateId]: Readonly<Record<string, CompiledMailTemplate>>;
};

/**
 * The stand-in the compiler renders in place of a context value.
 *
 * Deliberately alphanumeric and underscore-only: it travels through Vue's escaping, Maizzle's CSS
 * inlining, its entity encoding, and its HTML-to-plaintext conversion, and has to come out the
 * other side unchanged in text, in attributes, and inside `href` URLs alike.
 */
export function mailTemplatePlaceholder(field: string): string {
  return `__CZ_MAIL_${field}__`;
}

const PLACEHOLDER_PATTERN = /__CZ_MAIL_([A-Za-z0-9]+)__/g;
const HTML_ESCAPE_PATTERN = /["'&<>]/g;

const HTML_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/**
 * Escapes exactly what Vue's server renderer escapes in an interpolation.
 *
 * A substituted value is the one part of the message that never went through Vue, so it is the
 * one part that can carry markup: an organization name someone typed, or a URL whose query
 * separators would end an attribute. Escaping it here is what keeps it text.
 *
 * Stricter than the surrounding markup, which Maizzle's entity transformer leaves with a bare `&`
 * and `"` where Vue had written `&amp;` and `&quot;`. That decoding is safe for markup Maizzle
 * itself produced and unsafe for a value substituted afterwards, so the two legitimately differ.
 */
export function escapeMailHtml(value: string): string {
  return value.replaceAll(
    HTML_ESCAPE_PATTERN,
    (character) => HTML_ESCAPES.get(character) ?? character,
  );
}

/**
 * Names the variant a context selects: the fields it fills, in the order the template declares
 * them, joined with `+`. An empty string names the variant where none of them are filled.
 */
export function mailTemplateVariantKey(
  conditionalFields: readonly string[],
  context: Readonly<Record<string, string>>,
): string {
  // Plain truthiness, because that is what the template's own `v-if` tested before the markup was
  // compiled: a value this treats as filled has to be one the rendered variant printed.
  return conditionalFields.filter((field) => context[field]).join('+');
}

/**
 * Substitutes the message's own values into a compiled variant.
 *
 * A placeholder with no matching context field is left standing rather than blanked: that can
 * only mean the compiled artifact and the template registry disagree, which is a build problem to
 * surface, not a message to silently mail out with a hole in it.
 */
export function interpolateMailTemplate(
  compiled: string,
  context: Readonly<Record<string, string>>,
  escape: (value: string) => string,
): string {
  return compiled.replaceAll(PLACEHOLDER_PATTERN, (placeholder, field: string) => {
    const value = context[field];
    return value === undefined ? placeholder : escape(value);
  });
}
