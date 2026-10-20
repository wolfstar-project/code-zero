/* oxlint-disable no-console -- audit reporting */
// Unused translation remover, ported from wolfstar.rocks (Apache 2.0 license).
// Removes catalog keys that no consuming app file references (per vue-i18n-extract) from every
// locale's feature files. Review the diff: dynamically-built keys are false positives.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { styleText } from 'node:util';

import { createI18NReport, type I18NItem } from 'vue-i18n-extract';

import {
  FEATURE_FILES,
  REFERENCE_LOCALE,
  isJsonRecord,
  listLocaleCodes,
  loadMergedLocale,
  localeFeatureAbsolutePath,
  type NestedObject,
} from './utils/i18n-locale-files.ts';

// apps/web is this package's only current consumer; extend this list if a second one starts
// shipping translations here.
const VUE_FILES_GLOB = '../../apps/web/app/**/*.?(vue|ts|js)';

/** Removes a key path (e.g. "foo.bar.baz") from a nested object. Cleans up empty parents. */
function removeKey(obj: NestedObject, path: string): boolean {
  const [first, ...rest] = path.split('.');
  if (!first) return false;
  if (rest.length === 0) {
    if (first in obj) {
      delete obj[first];
      return true;
    }
    return false;
  }
  const child = obj[first];
  if (isJsonRecord(child)) {
    const removed = removeKey(child, rest.join('.'));
    if (removed && Object.keys(child).length === 0) {
      delete obj[first];
    }
    return removed;
  }
  return false;
}

/** Removes multiple keys from a nested object, deepest first to avoid parent/child conflicts. */
function removeKeysFromObject(obj: NestedObject, keys: string[]): number {
  const sortedKeys = [...keys].toSorted((a, b) => b.split('.').length - a.split('.').length);
  let removed = 0;
  for (const key of sortedKeys) {
    if (removeKey(obj, key)) removed++;
  }
  return removed;
}

async function run(): Promise<void> {
  console.log(styleText('bold', '\nRemoving unused i18n translations...\n'));

  // vue-i18n-extract keys catalogs by basename; merge feature files into one en.json.
  const tmpDir = await mkdtemp(join(tmpdir(), 'i18n-unused-'));
  const mergedPath = join(tmpDir, `${REFERENCE_LOCALE}.json`);
  await writeFile(mergedPath, `${JSON.stringify(loadMergedLocale(REFERENCE_LOCALE), null, 2)}\n`);

  try {
    const { unusedKeys } = await createI18NReport({
      vueFiles: VUE_FILES_GLOB,
      languageFiles: mergedPath,
      exclude: ['$schema'],
    });

    if (unusedKeys.length === 0) {
      console.log(styleText('green', 'No unused translations found. Nothing to remove.\n'));
      return;
    }

    const uniquePaths = [...new Set(unusedKeys.map((item: I18NItem) => item.path))];
    let totalRemoved = 0;

    for (const locale of listLocaleCodes()) {
      for (const feature of FEATURE_FILES) {
        const filePath = localeFeatureAbsolutePath(locale, feature);
        const parsed: unknown = JSON.parse(await readFile(filePath, 'utf-8'));
        if (!isJsonRecord(parsed)) throw new Error(`expected ${filePath} to contain a JSON object`);
        const removed = removeKeysFromObject(parsed, uniquePaths);
        if (removed > 0) {
          await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
          console.log(styleText('yellow', `  ${locale}/${feature}: removed ${removed} key(s)`));
          totalRemoved += removed;
        }
      }
    }

    console.log(
      styleText('green', `\nRemoved ${totalRemoved} unused translation entries across locales.\n`),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  console.error(styleText('red', '\nUnexpected error:'), error);
  process.exit(1);
});
