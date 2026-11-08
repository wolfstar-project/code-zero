import { useState } from 'nuxt/app';
// Imported explicitly rather than relying on Nuxt auto-imports, for the reason given in
// `useSidebarCollapsed.ts`.
import type { Ref } from 'vue';

/**
 * Whether the navigation drawer is open on a narrow screen.
 *
 * Separate from `useSidebarCollapsed`: collapsing narrows the desktop sidebar, opening slides the
 * same sidebar over the page below the `md` breakpoint, where there is no room to keep it docked.
 * The page navbar owns the button that opens it, the sidebar closes it, and the layout makes the
 * page behind it inert while it is open.
 */
export function useSidebarOpen(): Ref<boolean> {
  return useState<boolean>('sidebar-open', () => false);
}
