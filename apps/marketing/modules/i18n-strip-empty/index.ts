// Ported from wolfstar.rocks (Apache 2.0 license).
import { addVitePlugin, defineNuxtModule } from 'nuxt/kit';
import type { Plugin } from 'vite';

/**
 * Untranslated keys live in `i18n/locales/{locale}/*.json` as empty strings, so translators (and
 * Lunaria) still see the full key set without English text being copied into every locale.
 *
 * vue-i18n treats `""` as a valid translation and renders it verbatim. Dropping the empty leaves
 * before the JSON reaches the bundle makes the key genuinely absent, so vue-i18n falls back to
 * the default locale instead.
 */
const LOCALES_SEGMENT = '/i18n/locales/';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively remove empty-string leaves, and any object left empty by that removal. Returns
 * `undefined` when nothing is left to keep.
 */
export function stripEmptyMessages(value: JsonValue): JsonValue | undefined {
  if (value === '') return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const stripped = stripEmptyMessages(child);
    if (stripped !== undefined) result[key] = stripped;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function stripEmptyI18nMessagesPlugin(): Plugin {
  return {
    name: 'code-zero:i18n-empty-placeholders',
    // Must run before Vite's JSON plugin turns the file into an ES module.
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0]?.replaceAll('\\', '/');
      if (!path?.endsWith('.json') || !path.includes(LOCALES_SEGMENT)) return null;

      // Narrowed rather than asserted: a locale file that is not a JSON object would otherwise be
      // spread into an empty result and silently drop every message in it.
      const parsed: unknown = JSON.parse(code);
      if (!isJsonObject(parsed)) throw new Error(`expected ${path} to contain a JSON object`);

      // `$schema` is editor tooling metadata, not a translatable message.
      const { $schema: _schema, ...messages } = parsed;
      const stripped = stripEmptyMessages(messages) ?? {};
      return { code: JSON.stringify(stripped), map: null };
    },
  };
}

export default defineNuxtModule({
  meta: {
    name: 'i18n-strip-empty',
  },
  setup() {
    // `nuxt/kit`'s `addVitePlugin` types its `Plugin` parameter against its own bundled `vite`
    // dependency, which this monorepo resolves to a different instance than the `vite` this file
    // imports `Plugin` from — a duplicate-instance type mismatch, not a real structural one (the
    // plugin object is duck-typed and works regardless of which `Plugin` alias checked it).
    addVitePlugin(stripEmptyI18nMessagesPlugin() as Parameters<typeof addVitePlugin>[0]);
  },
});
