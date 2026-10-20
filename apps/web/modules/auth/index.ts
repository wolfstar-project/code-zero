import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from 'nuxt/kit';

/**
 * Registers `auth/components` (the signed-in user menu) and `auth/composables`
 * (useAuthErrorMessage). Unprefixed: the names here are already specific enough that nothing else
 * in the app — or Nuxt itself — registers them.
 */
export default defineNuxtModule({
  meta: {
    name: 'dashboard-auth',
  },
  setup() {
    const resolver = createResolver(import.meta.url);

    addComponentsDir({ path: resolver.resolve('./components') });
    addImportsDir(resolver.resolve('./composables'));
  },
});
