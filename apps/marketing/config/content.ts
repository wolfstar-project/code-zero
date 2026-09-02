/**
 * Structure of the landing page: which cards exist, in which order, and which translation key and
 * icon each one carries.
 *
 * Copy itself lives in `@code-zero/i18n` (`locales/<locale>/marketing.json`) so translators work
 * from one place and Lunaria can report staleness. This file only holds what is not language —
 * ordering, icons, prices, and link targets — which is also what the unit tests assert against the
 * dictionaries.
 */

export interface FeatureCard {
  /** Key under `marketing.features.items`; also the Vue list key. */
  readonly id: string;
  /** Lucide icon name resolved by `@nuxt/icon` from the locally installed collection. */
  readonly icon: string;
}

export interface Testimonial {
  /** Key under `marketing.testimonials.items`. */
  readonly id: string;
  /** Initials rendered in the avatar tile; no remote images on a page that must stay fast. */
  readonly initials: string;
}

export interface FaqEntry {
  /** Key under `marketing.faq.items`. */
  readonly id: string;
}

export type BillingInterval = 'monthly' | 'yearly';

export interface PricingPlan {
  /** Key under `marketing.pricing.plans`. */
  readonly id: string;
  /**
   * Price in whole units of {@link pricingCurrency} per interval, or `null` for
   * "talk to us" tiers that have no list price.
   */
  readonly price: Readonly<Record<BillingInterval, number>> | null;
  /** Keys under `marketing.pricing.plans.<id>.features`, in render order. */
  readonly features: readonly string[];
  /** At most one plan may set this; it drives the highlighted card and the "Recommended" badge. */
  readonly recommended?: boolean;
  /** Where the plan's call to action goes: an app route, or an external URL. */
  readonly ctaTarget: 'repository' | 'dashboard' | 'contact';
}

export const pricingCurrency = 'USD';

export const featureCards = [
  { id: 'observe', icon: 'lucide:eye' },
  { id: 'runner', icon: 'lucide:shield-check' },
  { id: 'verify', icon: 'lucide:circle-check-big' },
  { id: 'models', icon: 'lucide:cpu' },
  { id: 'sandbox', icon: 'lucide:box' },
  { id: 'policy', icon: 'lucide:scale' },
] as const satisfies readonly FeatureCard[];

export const testimonials = [
  { id: 'one', initials: 'MC' },
  { id: 'two', initials: 'JW' },
  { id: 'three', initials: 'AO' },
] as const satisfies readonly Testimonial[];

export const faqEntries = [
  { id: 'write' },
  { id: 'models' },
  { id: 'selfhost' },
  { id: 'secrets' },
  { id: 'cancel' },
] as const satisfies readonly FaqEntry[];

const pricingPlansConst = [
  {
    id: 'community',
    price: { monthly: 0, yearly: 0 },
    features: ['one', 'two', 'three', 'four'],
    ctaTarget: 'repository',
  },
  {
    id: 'team',
    // Yearly is ten months' worth, which is what `marketing.pricing.yearlyHint` promises.
    price: { monthly: 49, yearly: 490 },
    features: ['one', 'two', 'three', 'four', 'five'],
    recommended: true,
    ctaTarget: 'dashboard',
  },
  {
    id: 'enterprise',
    price: null,
    features: ['one', 'two', 'three', 'four', 'five'],
    ctaTarget: 'contact',
  },
] as const satisfies readonly PricingPlan[];

// Widened to the general interface: `as const` gives each array element its own literal type, so
// only the plan that sets `recommended: true` would type-check as having that property at all,
// and consumers would need an `'recommended' in plan` guard just to read it. `satisfies` above
// still validates every literal against `PricingPlan` at the declaration site.
export const pricingPlans: readonly PricingPlan[] = pricingPlansConst;

/**
 * Tools the pipeline already speaks, rendered as a wordmark row instead of customer logos: the
 * project has no logo usage rights to claim, and inventing them on a public page would be a lie.
 */
export const logoCloud = [
  { id: 'github', label: 'GitHub', icon: 'lucide:github' },
  { id: 'git', label: 'Git', icon: 'lucide:git-branch' },
  { id: 'node', label: 'Node.js', icon: 'lucide:hexagon' },
  { id: 'openai', label: 'OpenAI', icon: 'lucide:sparkles' },
  { id: 'anthropic', label: 'Anthropic', icon: 'lucide:brain-circuit' },
  { id: 'docker', label: 'Containers', icon: 'lucide:container' },
] as const satisfies readonly { id: string; label: string; icon: string }[];
