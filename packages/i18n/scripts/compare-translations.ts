/* oxlint-disable no-console -- audit reporting */
// Locale key-set audit, ported from wolfstar.rocks (Apache 2.0 license).
// Compares every locale's feature files against the `en/*` reference; `--fix` adds missing keys
// as empty placeholders and removes keys that no longer exist in the reference.
import { existsSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { styleText } from 'node:util';

import {
  FEATURE_FILES,
  REFERENCE_LOCALE,
  isJsonRecord,
  listLocaleCodes,
  localeFeatureAbsolutePath,
  readFeatureFile,
  withoutSchema,
  type NestedObject,
} from './utils/i18n-locale-files.ts';

const JSON_EXTENSION_PATTERN = /\.json$/;

interface SyncStats {
  missing: string[];
  extra: string[];
  feature: string;
  locale: string;
}

function syncLocaleData(
  reference: NestedObject,
  target: NestedObject,
  stats: SyncStats,
  fix: boolean,
  prefix = '',
): NestedObject {
  const result: NestedObject = {};

  for (const key of Object.keys(reference)) {
    if (key === '$schema') continue;
    const propertyPath = prefix ? `${prefix}.${key}` : key;
    const referenceValue = reference[key];

    if (isJsonRecord(referenceValue)) {
      const nextTarget = isJsonRecord(target[key]) ? target[key] : {};
      const data = syncLocaleData(referenceValue, nextTarget, stats, fix, propertyPath);
      if (fix && Object.keys(data).length === 0) continue;
      result[key] = data;
      continue;
    }

    if (key in target) {
      result[key] = target[key];
    } else {
      stats.missing.push(propertyPath);
      if (fix) {
        // Empty placeholder, never the English source string: copying the reference text makes an
        // untranslated key indistinguishable from a real translation for Lunaria and translators.
        // Empty leaves are stripped at build time by the consuming app (see
        // apps/web/modules/i18n-strip-empty), so the
        // runtime falls back to English.
        result[key] = '';
      }
    }
  }

  for (const key of Object.keys(target)) {
    if (key === '$schema') continue;
    if (!(key in reference)) {
      stats.extra.push(prefix ? `${prefix}.${key}` : key);
    }
  }

  return result;
}

function processFeature(locale: string, feature: string, fix: boolean): SyncStats {
  const reference = withoutSchema(readFeatureFile(REFERENCE_LOCALE, feature));
  const { $schema: targetSchema, ...target } = readFeatureFile(locale, feature);

  const stats: SyncStats = { missing: [], extra: [], feature, locale };
  const newContent = syncLocaleData(reference, target, stats, fix);

  if (fix && (stats.missing.length > 0 || stats.extra.length > 0)) {
    const output = targetSchema ? { $schema: targetSchema, ...newContent } : newContent;
    writeFileSync(
      localeFeatureAbsolutePath(locale, feature),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf-8',
    );
  }

  return stats;
}

function processLocale(locale: string, fix: boolean): SyncStats[] {
  return FEATURE_FILES.map((feature) => processFeature(locale, feature, fix));
}

function logSection(title: string, keys: string[], color: 'yellow' | 'green' | 'magenta'): void {
  console.log(`\n${styleText(color, title)}`);
  for (const key of keys) {
    console.log(`  - ${key}`);
  }
}

function reportLocale(locale: string, results: SyncStats[], fix: boolean): void {
  const missing = results.flatMap((stats) => stats.missing);
  const extra = results.flatMap((stats) => stats.extra);
  if (missing.length === 0 && extra.length === 0) return;

  console.log(`\n${styleText('cyan', `--- ${locale} ---`)}`);
  if (missing.length > 0) {
    logSection(
      fix
        ? 'ADDED MISSING KEYS (empty placeholders, EN used as runtime fallback)'
        : 'MISSING KEYS (in en/* but not in this locale)',
      missing,
      fix ? 'green' : 'yellow',
    );
  }
  if (extra.length > 0) {
    logSection(
      fix
        ? 'REMOVED EXTRA KEYS (were in this locale but not in en/*)'
        : 'EXTRA KEYS (in this locale but not in en/*)',
      extra,
      'magenta',
    );
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const localeArg = args.find((arg) => arg !== '--fix')?.replace(JSON_EXTENSION_PATTERN, '');

  const locales = localeArg
    ? [localeArg]
    : listLocaleCodes().filter((code) => code !== REFERENCE_LOCALE);

  for (const locale of locales) {
    if (!existsSync(localeFeatureAbsolutePath(locale, FEATURE_FILES[0] ?? ''))) {
      console.error(styleText('red', `Error: locale directory not found: locales/${locale}/`));
      process.exit(1);
    }
  }

  console.log(styleText('cyan', `=== Translation audit${fix ? ' (with --fix)' : ''} ===`));
  console.log(`Reference: locales/${REFERENCE_LOCALE}/{feature}.json`);
  console.log(`Checking ${locales.length} locale(s) × ${FEATURE_FILES.length} feature file(s)...`);

  let totalMissing = 0;
  let totalExtra = 0;

  for (const locale of locales) {
    const results = processLocale(locale, fix);
    totalMissing += results.reduce((sum, stats) => sum + stats.missing.length, 0);
    totalExtra += results.reduce((sum, stats) => sum + stats.extra.length, 0);
    reportLocale(locale, results, fix);
  }

  console.log(`\n${styleText('cyan', '=== Summary ===')}`);
  if (totalMissing === 0 && totalExtra === 0) {
    console.log(styleText('green', '  All locales are in sync!'));
    return;
  }

  const verb = fix ? 'Added' : 'Missing';
  if (totalMissing > 0) {
    console.log(styleText(fix ? 'green' : 'yellow', `  ${verb} keys: ${totalMissing}`));
  }
  if (totalExtra > 0) {
    console.log(styleText('magenta', `  ${fix ? 'Removed extra' : 'Extra'} keys: ${totalExtra}`));
  }
  if (!fix) {
    console.log(styleText('yellow', '  Run `aube run i18n:check:fix` to sync the locale files.'));
    process.exit(1);
  }
}

main();
