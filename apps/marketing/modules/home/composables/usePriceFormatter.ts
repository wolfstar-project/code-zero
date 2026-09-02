import { locales } from '@code-zero/i18n';
// Imported explicitly rather than relying on Nuxt auto-imports: the package's plain `tsc` pass
// checks `app/**/*.ts` without the generated auto-import declarations that `vue-tsc` sees.
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';

import { pricingCurrency } from '../../../config/content.js';

/**
 * BCP 47 tag per locale code, widened to a plain string index.
 *
 * `useI18n().locale` is typed as `string`, so looking it up in `locales` directly would need an
 * assertion into the narrower key union — one that is false for any locale the module reports and
 * this package does not ship.
 */
const languageByLocale: Record<string, string> = Object.fromEntries(
  Object.entries(locales).map(([code, definition]) => [code, definition.language]),
);

/**
 * Formats plan prices in the active locale.
 *
 * `Intl.NumberFormat` is constructed from the locale's BCP 47 tag so the same number renders as
 * "$49" in English and "49 USD" in Italian. Fraction digits are pinned to zero: every listed price
 * is a whole unit, and ".00" only adds noise to a pricing card.
 */
export function usePriceFormatter(): ComputedRef<(amount: number) => string> {
  const { locale } = useI18n();

  return computed(() => {
    const language = languageByLocale[locale.value] ?? locale.value;
    const formatter = new Intl.NumberFormat(language, {
      style: 'currency',
      currency: pricingCurrency,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });

    return (amount: number) => formatter.format(amount);
  });
}
