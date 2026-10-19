import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from 'nuxt/kit';

/**
 * Registers `settings/components` and `settings/composables`. Prefixed like the audit module:
 * names like Form and Services are generic enough to collide with the next feature module.
 *
 * `utils/` is deliberately not auto-imported: it is the form's mapping to and from the API, and
 * every caller imports it by name so the mapping stays one visible dependency.
 */
export default defineNuxtModule({
  meta: {
    name: 'dashboard-settings',
  },
  setup() {
    const resolver = createResolver(import.meta.url);

    addComponentsDir({ path: resolver.resolve('./components'), prefix: 'Settings' });
    addImportsDir(resolver.resolve('./composables'));
  },
});
