<template>
  <NuxtRouteAnnouncer />
  <NuxtLoadingIndicator color="var(--cz-accent)" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
import { locales } from '@code-zero/i18n';
import type { LocaleCode } from '@code-zero/i18n';

const { locale } = useI18n();

// `nuxt.config.ts` cannot know the active locale, so the document language is bound here instead.
useHead(() => ({
  htmlAttrs: { lang: locales[locale.value as LocaleCode]?.language ?? locale.value },
}));

// Spelled out here rather than resolved from config: the dashboard has one shell, one title, and
// one description, and `nuxt.config.ts` needs the same title as a literal before the app boots.
const title = 'Code Zero · Dashboard';
const description =
  'Operational dashboard for Code Zero, the open-source autonomous engineer that finds, fixes, and verifies problems in pull requests.';

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogType: 'website',
  // An internal operations console has nothing to gain from being indexed.
  robots: 'noindex, nofollow',
});
</script>
