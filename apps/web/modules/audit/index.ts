import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from 'nuxt/kit';

/**
 * Registers `audit/components` and `audit/composables`. Prefixed for the same reason the
 * organizations module is: names like Table and OutcomeBadge are generic enough that an
 * unprefixed registration would be a collision waiting for the next feature module.
 */
export default defineNuxtModule({
  meta: {
    name: 'dashboard-audit',
  },
  setup() {
    const resolver = createResolver(import.meta.url);

    addComponentsDir({ path: resolver.resolve('./components'), prefix: 'Audit' });
    addImportsDir(resolver.resolve('./composables'));
  },
});
