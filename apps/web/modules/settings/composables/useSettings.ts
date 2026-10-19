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

  async function refresh(): Promise<void> {
    pending.value = true;
    error.value = null;
    try {
      view.value = await read();
    } catch (caught) {
      view.value = null;
      error.value = classifySettingsError(caught);
    } finally {
      pending.value = false;
    }
  }

  /** Takes the view a successful save answered with, so the page shows what the server stored. */
  function replace(next: SettingsView): void {
    view.value = next;
    error.value = null;
  }

  return { view, pending, error, refresh, replace };
}
