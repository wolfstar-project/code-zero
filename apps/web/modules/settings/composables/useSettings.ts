// Imported explicitly rather than relying on Nuxt auto-imports, so the dependency stays visible at
// the call site; `nuxt typecheck` resolves either form.
import type { SettingsView } from '@code-zero/api';
import { shallowRef } from 'vue';

import { classifySettingsError, type SettingsError } from '../utils/form';

/** Reads the settings page's read model; `$orpc.settings.get` from the page that owns the client. */
export type SettingsReader = () => Promise<SettingsView>;

/**
 * The deployment's settings as `settings.get` describes them for the signed-in reader.
 *
 * Client-side only, like the audit log: the procedure authenticates the browser's session, and
 * what it returns depends on who asks. A failed read clears the view rather than leaving a stale
 * one on screen, because a page that still shows settings after a refusal reads as permission.
 */
export function useSettings(read: SettingsReader) {
  const view = shallowRef<SettingsView | null>(null);
  const pending = shallowRef(false);
  const error = shallowRef<SettingsError | null>(null);
  // Reads can overlap — the organization switcher asks again while an earlier read is in flight —
  // and only the most recent request describes what the page should show. Each read takes a
  // number, and an answer whose number is no longer the latest is dropped, however late it lands.
  let latest = 0;

  async function refresh(): Promise<void> {
    const request = ++latest;
    pending.value = true;
    error.value = null;
    try {
      const next = await read();
      if (request !== latest) return;
      view.value = next;
    } catch (caught) {
      if (request !== latest) return;
      view.value = null;
      error.value = classifySettingsError(caught);
    } finally {
      if (request === latest) pending.value = false;
    }
  }

  /** Takes the view a successful save answered with, so the page shows what the server stored. */
  function replace(next: SettingsView): void {
    view.value = next;
    error.value = null;
  }

  return { view, pending, error, refresh, replace };
}
