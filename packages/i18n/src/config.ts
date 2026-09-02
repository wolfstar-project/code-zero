// Ported from wolfstar.rocks (Apache 2.0 license).
import type {
  DateTimeFormats,
  NumberFormats,
  PluralizationRule,
  PluralizationRules,
} from '@intlify/core-base';
import type { LocaleObject } from '@nuxtjs/i18n';

import localeFeatures from '../locales/locale-features.json' with { type: 'json' };

export interface LocaleObjectData extends LocaleObject {
  numberFormats?: NumberFormats;
  dateTimeFormats?: DateTimeFormats;
  pluralRule?: PluralizationRule;
}

/**
 * Feature message files loaded (and deep-merged) per locale via `files`.
 * Layout: `locales/{locale}/{feature}.json`
 *
 * Translations are split by scope rather than kept in one file per locale, which is also the unit
 * Lunaria reports progress on. Lazy-loading is always on in `@nuxtjs/i18n` v10 when using `files`.
 */
export const localeFeatureFiles = localeFeatures.features as readonly string[];

/** A feature file name (`common.json`, `marketing.json`, …) this package ships translations for. */
export type LocaleFeatureFile = (typeof localeFeatureFiles)[number];

function localeFilesFor(localeCode: string, features: readonly string[]): string[] {
  return features.map((feature) => `${localeCode}/${feature}`);
}

/**
 * Single source of truth for which locales this repository ships: `LocaleCode` and
 * `currentLocales` are both derived from this, so adding a locale here is the only edit needed —
 * unlike a hand-typed `LocaleCode` union kept beside a separate locale array, which a contributor
 * can update in one place and forget in the other without either the compiler or a test catching
 * the drift.
 *
 * wolfstar.rocks's own `config/i18n.ts` (this file's source) expands regional variants (`en` into
 * `en-US`/`en-GB`, and so on) and per-locale plural rules from a much larger locale set. This
 * repository ships exactly `en` and `it`, with no regional split and no locale whose plural rules
 * differ from `Intl.PluralRules`' defaults, so that expansion step is omitted rather than kept as
 * unexercised machinery — add it back if a regional variant is ever actually needed.
 */
const localeMetadata = {
  en: { name: 'English', language: 'en-US' },
  it: { name: 'Italiano', language: 'it-IT' },
} as const;

/** Locale codes this repository can render. */
export type LocaleCode = keyof typeof localeMetadata;

export const defaultLocale = 'en' satisfies LocaleCode;

/** Cookie `@nuxtjs/i18n` persists the visitor's locale choice in. */
export const localeCookieName = 'code-zero-locale';

/** Locales registered with Nuxt i18n, sorted by code. */
export const currentLocales: LocaleObjectData[] = Object.entries(localeMetadata)
  .map(([code, { name, language }]) => ({
    code,
    files: localeFilesFor(code, localeFeatureFiles),
    name,
    language,
  }))
  .toSorted((a, b) => a.code.localeCompare(b.code));

export const datetimeFormats = currentLocales.reduce<DateTimeFormats>((acc, data) => {
  acc[data.code] = {
    shortDate: { dateStyle: 'short' },
    short: { dateStyle: 'short', timeStyle: 'short' },
    long: { dateStyle: 'long', timeStyle: 'medium' },
  };
  return acc;
}, {});

export const numberFormats = currentLocales.reduce<NumberFormats>((acc, data) => {
  acc[data.code] = {
    percentage: { style: 'percent', maximumFractionDigits: 1 },
    smallCounting: { style: 'decimal', maximumFractionDigits: 0 },
    kiloCounting: { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 },
    millionCounting: { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 2 },
  };
  return acc;
}, {});

/**
 * Empty today: no shipped locale needs a plural rule beyond `Intl.PluralRules`' own default
 * selection. Kept as a typed, populated-when-needed export (vue-i18n's `pluralRules` option)
 * rather than removed, since `i18n.config.ts` already wires it through.
 */
export const pluralRules: PluralizationRules = {};

/** Presentation metadata for a locale a consuming app ships translations for. */
export interface LocaleDefinition {
  /** Name of the language, written in that language, for the locale switcher. */
  readonly label: string;
  /** BCP 47 tag used for `<html lang>` and date formatting. */
  readonly language: string;
}

/**
 * `currentLocales` keyed by code, for the switcher and head metadata, which look one up directly
 * rather than scanning the array.
 */
export const locales = currentLocales.reduce<Record<LocaleCode, LocaleDefinition>>(
  (acc, locale) => {
    // `locale.code` is `string` per `LocaleObject`, but `currentLocales` is built above from
    // `localeMetadata`'s own keys, so every value it actually holds is a `LocaleCode`.
    // oxlint-disable-next-line no-unsafe-type-assertion -- narrowed by construction, see above
    acc[locale.code as LocaleCode] = {
      label: locale.name ?? locale.code,
      language: locale.language ?? locale.code,
    };
    return acc;
  },
  // The accumulator is filled for every `LocaleCode` in the loop above, but an empty object
  // literal can't prove that to the compiler.
  // oxlint-disable-next-line no-unsafe-type-assertion -- narrowed by construction, see above
  {} as Record<LocaleCode, LocaleDefinition>,
);

/**
 * `currentLocales` narrowed to the scopes an app actually renders.
 *
 * The dashboard and the marketing site share `common` and `errors` but have no use for each
 * other's copy, and every listed file is deep-merged into the bundle whether or not a key from it
 * is ever read.
 *
 * @throws If a requested feature file is not one this package ships, which would otherwise fail
 *   later as a missing-file error inside the module's locale loader.
 */
export function i18nLocalesFor(features: readonly LocaleFeatureFile[]): LocaleObjectData[] {
  const unknown = features.filter((feature) => !localeFeatureFiles.includes(feature));
  if (unknown.length > 0) throw new Error(`unknown locale feature file(s): ${unknown.join(', ')}`);

  // Two locales, called at module init, not a hot path — the allocation this rule warns about is
  // immaterial here, and Object.assign/direct-assignment alternatives fight prefer-spread-syntax.
  // oxlint-disable-next-line no-map-spread -- see above
  return currentLocales.map((locale) => ({
    ...locale,
    files: localeFilesFor(locale.code, features),
  }));
}
