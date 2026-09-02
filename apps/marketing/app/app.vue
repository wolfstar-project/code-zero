<template>
  <NuxtRouteAnnouncer />
  <NuxtLoadingIndicator color="var(--cz-accent)" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
const { t } = useI18n();

// `<html lang>`, `<html dir>`, the `hreflang` alternates for every locale, and the `og:locale`
// pair. Emitting these by hand is what makes a translated route indexable as its own document
// rather than as a duplicate of the default locale, so it is delegated to the module that knows
// the full route table.
const localeHead = useLocaleHead({ dir: true, lang: true, seo: true });

useHead(() => ({
  // The suffix every page title carries, so each page only declares its own name. Pages without a
  // title (there should be none) fall back to the bare app name rather than a dangling separator.
  titleTemplate: (title) => (title ? `${title} · ${site.name}` : site.name),
  htmlAttrs: localeHead.value.htmlAttrs,
  link: localeHead.value.link,
  meta: localeHead.value.meta,
}));

// Site-wide defaults. Pages override `title` and `description` with their own; anything a page
// does not set is inherited from here, which is what keeps every route shareable.
useSeoMeta({
  ogSiteName: site.name,
  ogType: 'website',
  ogImage: '/og-image.svg',
  twitterCard: 'summary_large_image',
  description: () => t('marketing.pages.home.description'),
});
</script>
