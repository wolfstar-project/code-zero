<template>
  <div>
    <HomeHero />
    <HomeLogoCloud />
    <HomeFeatureGrid />
    <HomePricingTable />
    <HomeFaq />
    <HomeCallToAction />
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();

// Getters rather than plain strings: the locale can change without a page reload, and
// `useSeoMeta` re-renders the tags when the reactive source does.
useSeoMeta({
  title: () => t('marketing.pages.home.title'),
  description: () => t('marketing.pages.home.description'),
  ogTitle: () => t('marketing.pages.home.title'),
  ogDescription: () => t('marketing.pages.home.description'),
});
</script>
