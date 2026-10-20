/* oxlint-disable no-console -- audit reporting */
// Static i18n usage report, ported from wolfstar.rocks (Apache 2.0 license).
// Cross-checks the keys used in the consuming app's source against the reference catalog: missing
// and dynamic keys fail the run, unused keys are reported as warnings (see `i18n:report:fix` to
// remove them).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { styleText } from 'node:util';

import { createI18NReport, type I18NItem, type I18NReport } from 'vue-i18n-extract';

import {
  LOCALES_DIRECTORY,
  REFERENCE_LOCALE,
  loadMergedLocale,
} from './utils/i18n-locale-files.ts';

// apps/web is this package's only current consumer; extend this list if a second one starts
// shipping translations here.
const VUE_FILES_GLOB = '../../apps/web/app/**/*.?(vue|ts|js)';

function printSection(
  title: string,
  items: I18NItem[],
  status: 'error' | 'warning' | 'success',
): void {
  const color = status === 'error' ? 'red' : status === 'warning' ? 'yellow' : 'green';
  console.log(`\n${styleText('bold', title)}: ${styleText(color, String(items.length))}`);

  const groupedByFile = new Map<string, string[]>();
  for (const item of items) {
    const file = item.file ?? 'unknown';
    groupedByFile.set(file, [...(groupedByFile.get(file) ?? []), item.path]);
  }

  for (const [file, keys] of groupedByFile) {
    console.log(`  ${styleText('dim', file)}`);
    for (const key of keys) {
      console.log(`    ${styleText('cyan', key)}`);
    }
  }
}

/**
 * vue-i18n-extract treats each languageFiles basename as a separate "language". The dashboard's
 * locales are split across feature files under `en/*.json`, so pass a single merged `en.json`
 * temp file instead of the feature glob.
 */
async function createMergedReferenceReport(): Promise<{
  report: I18NReport;
  cleanup: () => Promise<void>;
}> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'i18n-report-'));
  const mergedPath = join(tmpDir, `${REFERENCE_LOCALE}.json`);
  await writeFile(mergedPath, `${JSON.stringify(loadMergedLocale(REFERENCE_LOCALE), null, 2)}\n`);

  const report = await createI18NReport({
    vueFiles: VUE_FILES_GLOB,
    languageFiles: mergedPath,
    exclude: ['$schema'],
  });

  return {
    report,
    cleanup: async () => {
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

async function run(): Promise<void> {
  console.log(styleText('bold', '\nAnalyzing i18n translations...'));
  console.log(styleText('dim', `Reference: ${join(LOCALES_DIRECTORY, REFERENCE_LOCALE)} (merged)`));

  const { report, cleanup } = await createMergedReferenceReport();
  try {
    const { missingKeys, unusedKeys, maybeDynamicKeys } = report;

    printSection('Missing keys', missingKeys, missingKeys.length > 0 ? 'error' : 'success');
    // Unused detection cannot see dynamically-built keys, so it is reported without failing.
    printSection('Unused keys', unusedKeys, unusedKeys.length > 0 ? 'warning' : 'success');
    printSection(
      'Dynamic keys (cannot be statically analyzed)',
      maybeDynamicKeys,
      maybeDynamicKeys.length > 0 ? 'error' : 'success',
    );

    if (missingKeys.length > 0 || maybeDynamicKeys.length > 0) {
      console.log(styleText('red', '\nFailed: missing or dynamic keys detected'));
      console.log(
        styleText('dim', '  Fix missing keys by adding them to the locale feature files'),
      );
      console.log(styleText('dim', '  Fix dynamic keys by using static translation keys\n'));
      process.exit(1);
    }

    if (unusedKeys.length > 0) {
      console.log(
        styleText(
          'yellow',
          `\n${unusedKeys.length} unused key(s) reported (dynamic keys may be false positives).`,
        ),
      );
      console.log(styleText('dim', '  Remove with `aube run i18n:report:fix` if truly unused.'));
    }
    console.log(styleText('green', '\nAll translations are valid!\n'));
  } finally {
    await cleanup();
  }
}

run().catch((error: unknown) => {
  console.error(styleText('red', '\nUnexpected error:'), error);
  process.exit(1);
});
