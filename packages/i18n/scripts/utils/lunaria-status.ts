// Formatting for the translation status report written by `scripts/i18n-status.ts`.

/**
 * One missing-key entry: the localization file, then the key as a dotted path.
 *
 * @lunariajs/core reports a missing key as its path segments (`['auth', 'signIn', 'title']`), so
 * the segments are joined here rather than interpolated, which would comma-separate them.
 */
export function formatMissingKey(localizationPath: string, key: readonly string[]): string {
  return `${localizationPath}: ${key.join('.')}`;
}
