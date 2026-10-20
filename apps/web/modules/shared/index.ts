import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from 'nuxt/kit';

/**
 * Registers `shared/components` (sidebar, locale switcher, color-mode toggle, error page):
 * elements every page of the shell uses, so — unlike `organizations` — this module registers them
 * without a prefix. Nesting is preserved by the scanner, so `components/app/Sidebar.vue` stays
 * `<AppSidebar>`. `shared/composables` (useSidebarCollapsed) and `shared/utils` (error-status
 * helpers) are registered for auto-import the same way, so call sites don't need path imports back
 * into this module.
 */
export default defineNuxtModule({
  meta: {
    name: 'dashboard-shared',
  },
  setup() {
    const resolver = createResolver(import.meta.url);

    addComponentsDir({ path: resolver.resolve('./components') });
    addImportsDir(resolver.resolve('./composables'));
    addImportsDir(resolver.resolve('./utils'));
  },
});
