import {
  currentLocales,
  datetimeFormats,
  defaultLocale,
  numberFormats,
  pluralRules,
} from '@code-zero/i18n';

export default defineI18nConfig(() => {
  return {
    availableLocales: currentLocales.map((l) => l.code),
    fallbackLocale: defaultLocale,
    // Untranslated keys ship as empty strings and are stripped from the bundle by the
    // `i18n-strip-empty` local module, so falling back to the default locale is routine,
    // expected behavior in this app — not something to warn about on every render.
    fallbackWarn: false,
    missingWarn: false,
    datetimeFormats,
    numberFormats,
    pluralRules,
  };
});
