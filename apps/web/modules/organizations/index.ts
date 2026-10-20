import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from 'nuxt/kit';

/**
 * Registers `organizations/components` and `organizations/composables`. Prefixed so the module's
 * generic names (Switcher, MemberList, InviteForm) cannot collide with another module's component
 * of the same name.
 *
 * `organizations/types` stays a path import for the same reason as `dashboard/types`: types only,
 * nothing to auto-import.
 */
export default defineNuxtModule({
  meta: {
    name: 'dashboard-organizations',
  },
  setup() {
    const resolver = createResolver(import.meta.url);

    addComponentsDir({ path: resolver.resolve('./components'), prefix: 'Organizations' });
    addImportsDir(resolver.resolve('./composables'));
  },
});
