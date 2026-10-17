import { useState } from 'nuxt/app';
// Imported explicitly rather than relying on Nuxt auto-imports: the package's plain `tsc` pass
// checks `app/**/*.ts` without the generated auto-import declarations that `vue-tsc` sees.
import type { Ref } from 'vue';

/**
 * Shared between the sidebar (which owns the toggle) and the default layout (which shifts the
 * main column), so both react to the same collapse state.
 */
export function useSidebarCollapsed(): Ref<boolean> {
  return useState<boolean>('sidebar-collapsed', () => false);
}
