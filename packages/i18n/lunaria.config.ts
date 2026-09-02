import type { Locale } from '@lunariajs/core';
import { defineConfig } from '@lunariajs/core/config';

import { defaultLocale, locales } from './src/config.js';

// Derived from `src/config.ts` so the translation status can never drift from the locales this
// package actually ships. Lunaria wants a source locale plus a non-empty list of targets.
const sourceLocale: Locale = { label: locales[defaultLocale].label, lang: defaultLocale };

const targetLocales = Object.entries(locales)
  .filter(([lang]) => lang !== defaultLocale)
  .map(([lang, definition]): Locale => ({ label: definition.label, lang }));

if (targetLocales.length === 0) {
  throw new Error('No locales found besides source locale');
}

export default defineConfig({
  repository: {
    name: 'wolfstar-project/code-zero',
    rootDir: 'packages/i18n',
  },
  sourceLocale,
  locales: targetLocales as [Locale, ...Locale[]],
  files: [
    {
      include: ['locales/en/**/*.json'],
      pattern: 'locales/@lang/@path',
      type: 'dictionary',
    },
  ],
});
