import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { locales } from '@code-zero/i18n';
import { describe, expect, it } from 'vitest';

import {
  faqEntries,
  featureCards,
  logoCloud,
  pricingPlans,
  testimonials,
} from '../../config/content.js';

/**
 * The landing page's structure lives in `config/content.ts` while its words live in
 * `@code-zero/i18n`. Nothing at build time connects the two — a card whose id has no matching
 * dictionary entry renders its raw key path as visible text — so the contract is asserted here,
 * against the real dictionaries, for every locale the site ships.
 */
const i18nLocalesDirectory = join(
  dirname(fileURLToPath(import.meta.resolve('@code-zero/i18n/package.json'))),
  'locales',
);

const localeCodes = Object.keys(locales);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMarketingMessages(locale: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    readFileSync(join(i18nLocalesDirectory, locale, 'marketing.json'), 'utf8'),
  );
  if (!isRecord(parsed) || !isRecord(parsed.marketing))
    throw new Error(`${locale}/marketing.json has no "marketing" root`);
  return parsed.marketing;
}

/** Resolves a dotted key path, returning `undefined` for any missing or non-string leaf. */
function messageAt(messages: Record<string, unknown>, path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, messages);

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

describe.each(localeCodes)('%s dictionary', (locale) => {
  const messages = readMarketingMessages(locale);

  it.each(featureCards.map((feature) => feature.id))('translates the %s feature card', (id) => {
    expect(messageAt(messages, `features.items.${id}.title`)).toBeDefined();
    expect(messageAt(messages, `features.items.${id}.description`)).toBeDefined();
  });

  it.each(testimonials.map((entry) => entry.id))('translates the %s testimonial', (id) => {
    expect(messageAt(messages, `testimonials.items.${id}.quote`)).toBeDefined();
    expect(messageAt(messages, `testimonials.items.${id}.author`)).toBeDefined();
    expect(messageAt(messages, `testimonials.items.${id}.role`)).toBeDefined();
  });

  it.each(faqEntries.map((entry) => entry.id))('translates the %s FAQ entry', (id) => {
    expect(messageAt(messages, `faq.items.${id}.question`)).toBeDefined();
    expect(messageAt(messages, `faq.items.${id}.answer`)).toBeDefined();
  });

  it.each(pricingPlans.map((plan) => plan.id))('translates the %s plan', (id) => {
    const plan = pricingPlans.find((candidate) => candidate.id === id);

    expect(messageAt(messages, `pricing.plans.${id}.name`)).toBeDefined();
    expect(messageAt(messages, `pricing.plans.${id}.description`)).toBeDefined();
    expect(messageAt(messages, `pricing.plans.${id}.cta`)).toBeDefined();
    for (const feature of plan?.features ?? []) {
      expect(messageAt(messages, `pricing.plans.${id}.features.${feature}`)).toBeDefined();
    }
  });
});

describe('content structure', () => {
  it('keeps every id unique within its section', () => {
    for (const section of [featureCards, testimonials, faqEntries, pricingPlans, logoCloud]) {
      const ids = section.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('highlights at most one plan', () => {
    const recommended = pricingPlans.filter((plan) => 'recommended' in plan && plan.recommended);

    expect(recommended.length).toBeLessThanOrEqual(1);
  });

  it('prices the yearly interval at ten months, as the yearly hint promises', () => {
    for (const plan of pricingPlans) {
      if (!plan.price || plan.price.monthly === 0) continue;
      expect(plan.price.yearly).toBe(plan.price.monthly * 10);
    }
  });

  it('never lists a negative price', () => {
    for (const plan of pricingPlans) {
      if (!plan.price) continue;
      expect(plan.price.monthly).toBeGreaterThanOrEqual(0);
      expect(plan.price.yearly).toBeGreaterThanOrEqual(0);
    }
  });
});
