// Translation status reporter, inspired by npmx.dev's Lunaria build script (MIT license).
// The status is computed through @lunariajs/core's API rather than its CLI.
import { mkdirSync, writeFileSync } from 'node:fs';

import { createLunaria } from '@lunariajs/core';

import { formatMissingKey } from './utils/lunaria-status.ts';

// `force: true` bypasses git caching so the status stays correct after rebases and merges.
const lunaria = await createLunaria({ force: true });
const status = await lunaria.getFullStatus();

const summaries = lunaria.config.locales.map((locale) => {
  const missingFiles: string[] = [];
  const outdatedFiles: string[] = [];
  const missingKeys: string[] = [];

  for (const entry of status) {
    const localization = entry.localizations.find((candidate) => candidate.lang === locale.lang);
    if (!localization) continue;

    if (localization.status === 'missing') {
      missingFiles.push(entry.source.path);
      continue;
    }

    if (localization.status === 'outdated') {
      outdatedFiles.push(localization.path);
    }

    if ('missingKeys' in localization) {
      missingKeys.push(
        ...localization.missingKeys.map((key) => formatMissingKey(localization.path, key)),
      );
    }
  }

  return { lang: locale.lang, label: locale.label, missingFiles, outdatedFiles, missingKeys };
});

const report = {
  generatedAt: new Date().toISOString(),
  sourceLocale: lunaria.config.sourceLocale,
  locales: summaries,
};

mkdirSync('dist/lunaria', { recursive: true });
writeFileSync('dist/lunaria/status.json', `${JSON.stringify(report, null, 2)}\n`);

for (const summary of summaries) {
  const problems =
    summary.missingFiles.length + summary.outdatedFiles.length + summary.missingKeys.length;
  // oxlint-disable-next-line no-console -- status reporting
  console.log(
    problems === 0
      ? `${summary.lang} (${summary.label}): up to date`
      : `${summary.lang} (${summary.label}): ${summary.missingFiles.length} missing file(s), ${summary.outdatedFiles.length} outdated file(s), ${summary.missingKeys.length} missing key(s)`,
  );
}
// oxlint-disable-next-line no-console -- status reporting
console.log('Wrote dist/lunaria/status.json');
