import { useHotkeys, useHotkeySequences } from '@tanstack/vue-hotkeys';
// Imported explicitly rather than relying on Nuxt auto-imports: the package's plain `tsc` pass
// checks `app/**/*.ts` without the generated auto-import declarations that `vue-tsc` sees.
// `useRouter` comes from `nuxt/app` rather than `vue-router`, which is not a direct dependency
// here and so does not resolve in that pass.
import { useRouter, useState } from 'nuxt/app';
import type { Ref } from 'vue';

import { useSidebarCollapsed } from './useSidebarCollapsed';

/**
 * One row of the shortcut sheet.
 *
 * `chords` is what the reader presses: a single entry is a plain hotkey, more than one is a
 * sequence pressed in order. The strings are TanStack Hotkeys syntax, which is also what
 * `formatForDisplay` renders, so the sheet can never drift from what is actually registered.
 */
export interface AppShortcut {
  chords: readonly string[];
  labelKey: string;
}

/**
 * Every shortcut the dashboard binds, in the order the sheet lists them.
 *
 * Kept as one table rather than declared at each call site because the help sheet is only useful
 * if it is exhaustive, and a shortcut registered somewhere this list does not know about is a
 * shortcut nobody can discover. The page-scoped rows are registered by their own page and do
 * nothing elsewhere; they are listed here so `?` answers "what can I press" for the whole app.
 */
export const APP_SHORTCUTS: readonly AppShortcut[] = [
  { chords: ['G', 'C'], labelKey: 'dashboard.shortcuts.control' },
  { chords: ['G', 'A'], labelKey: 'dashboard.shortcuts.audit' },
  { chords: ['B'], labelKey: 'dashboard.shortcuts.sidebar' },
  { chords: ['Shift+/'], labelKey: 'dashboard.shortcuts.help' },
  { chords: ['R'], labelKey: 'dashboard.shortcuts.refresh' },
  { chords: ['/'], labelKey: 'dashboard.shortcuts.filter' },
  { chords: ['J'], labelKey: 'dashboard.shortcuts.next' },
  { chords: ['K'], labelKey: 'dashboard.shortcuts.previous' },
  { chords: ['M'], labelKey: 'dashboard.shortcuts.more' },
];

/** Whether the shortcut sheet is open; shared so any surface can toggle it. */
export function useShortcutsDialog(): Ref<boolean> {
  return useState<boolean>('shortcuts-dialog', () => false);
}

/**
 * Binds the shortcuts that work on every dashboard page.
 *
 * Called from the default layout rather than from a plugin, so the bindings live and die with the
 * dashboard shell: the sign-in pages use a different layout and should not answer to `g a`.
 * Registration happens on the client only — the composables attach to `document`, which does not
 * exist during SSR.
 */
export function useAppShortcuts(): void {
  const router = useRouter();
  const collapsed = useSidebarCollapsed();
  const dialogOpen = useShortcutsDialog();

  // Gated on the sheet being closed: it is a modal overlay, and without the guard `g a`/`g c`
  // would still navigate and `b` would still move the sidebar out from under it while the reader
  // is looking at the sheet instead of the page it would obscure.
  const notWhileDialogOpen = { enabled: () => !dialogOpen.value };

  // Vim-style prefixes: `g` then the page's initial. A sequence rather than a bare letter because
  // single letters are the scarce namespace, and navigation is the least frequent action here.
  useHotkeySequences(
    [
      { sequence: ['G', 'C'], callback: () => void router.push('/') },
      { sequence: ['G', 'A'], callback: () => void router.push('/audit') },
    ],
    notWhileDialogOpen,
  );

  useHotkeys([
    {
      hotkey: 'B',
      callback: () => {
        collapsed.value = !collapsed.value;
      },
      options: notWhileDialogOpen,
    },
    {
      // Object form because the `Hotkey` string union does not enumerate Shift with punctuation;
      // `?` is Shift+/ on the layouts this dashboard targets. Left ungated, unlike the bindings
      // above: it is also how the sheet closes, so disabling it while open would trap the reader.
      hotkey: { key: '/', shift: true },
      callback: () => {
        dialogOpen.value = !dialogOpen.value;
      },
    },
  ]);
}
