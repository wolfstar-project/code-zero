import { shallowRef } from 'vue';

import { classifySettingsError, type SettingsError } from '../utils/form';

/** `$orpc.settings.export` from the page that owns the client. */
export type SettingsExporter = () => Promise<{ yaml: string }>;

/**
 * The settings as the YAML `config.yml` would hold, fetched only when asked for.
 *
 * The server renders it with every environment secret redacted, and the settings themselves refuse
 * anything shaped like a credential, so what arrives here is safe to download or copy whole.
 */
export function useSettingsExport(read: SettingsExporter) {
  const yaml = shallowRef<string | null>(null);
  const pending = shallowRef(false);
  const error = shallowRef<SettingsError | null>(null);

  async function load(): Promise<string | null> {
    pending.value = true;
    error.value = null;
    try {
      const result = await read();
      yaml.value = result.yaml;
      return result.yaml;
    } catch (caught) {
      yaml.value = null;
      error.value = classifySettingsError(caught);
      return null;
    } finally {
      pending.value = false;
    }
  }

  return { yaml, pending, error, load };
}
